"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, requireSession, hasPermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { PaymentRequestStatus } from "@prisma/client";
import { selectApprovalRoute, roleForStep, isFinalStep, type ApprovalRouteCandidate } from "@/lib/payment-requests/approval";

async function loadActiveRoutes(): Promise<ApprovalRouteCandidate[]> {
  const routes = await prisma.paymentApprovalRoute.findMany({
    where: { isArchived: false },
    include: { steps: true },
  });
  return routes.map((r) => ({
    id: r.id,
    priority: r.priority,
    minAmount: r.minAmount,
    maxAmount: r.maxAmount,
    organizationId: r.organizationId,
    steps: r.steps.map((s) => ({ stepOrder: s.stepOrder, roleId: s.roleId })),
  }));
}

export async function createPaymentRequestAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYMENT_REQUEST_CREATE);

  const organizationId = String(formData.get("organizationId") ?? "");
  const counterpartyId = String(formData.get("counterpartyId") ?? "") || null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const amountRaw = String(formData.get("amount") ?? "");
  const dueDateRaw = String(formData.get("dueDate") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!organizationId || !amountRaw || Number(amountRaw) <= 0 || !dueDateRaw) {
    redirect(`/payment-requests/new?error=${encodeURIComponent("Заполните организацию, сумму и срок оплаты")}`);
  }

  const routes = await loadActiveRoutes();
  const route = selectApprovalRoute(routes, { amount: amountRaw, organizationId });

  const created = await prisma.paymentRequest.create({
    data: {
      organizationId,
      counterpartyId,
      cashFlowArticleId,
      amount: amountRaw,
      dueDate: new Date(dueDateRaw),
      comment,
      createdById: session.userId,
      status: PaymentRequestStatus.PENDING_APPROVAL,
      routeId: route?.id ?? null,
      currentStep: 1,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: created.id,
    action: "create",
    after: created as never,
  });

  revalidatePath("/payment-requests");
  redirect("/payment-requests");
}

const TRANSITION_PERMISSION: Record<string, (typeof PERMISSIONS)[keyof typeof PERMISSIONS]> = {
  [PaymentRequestStatus.CANCELLED]: PERMISSIONS.PAYMENT_REQUEST_APPROVE,
  [PaymentRequestStatus.PAID]: PERMISSIONS.CASH_MANAGE,
};

async function transition(id: string, status: PaymentRequestStatus, action: string) {
  const session = await requirePermission(TRANSITION_PERMISSION[status]);

  const before = await prisma.paymentRequest.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.paymentRequest.update({ where: { id }, data: { status } });

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action,
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/payment-requests");
  revalidatePath("/payment-calendar");
}

/**
 * Согласование/отклонение шага маршрута. Заявка без маршрута (routeId
 * null) идёт по старому одноступенчатому согласованию — нужно общее право
 * payment_requests.approve. Заявка с маршрутом требует членства именно в
 * роли текущего шага (или admin.full в обход) — так «Руководитель
 * подразделения» может согласовать свой шаг, даже не имея этого общего
 * права.
 */
async function decideStep(id: string, decision: "approved" | "rejected") {
  const session = await requireSession();

  const request = await prisma.paymentRequest.findUniqueOrThrow({
    where: { id },
    include: { route: { include: { steps: true } } },
  });

  if (request.status !== PaymentRequestStatus.PENDING_APPROVAL) {
    redirect(`/payment-requests?error=${encodeURIComponent("Заявка уже не на согласовании")}`);
  }

  const isAdmin = hasPermission(session, PERMISSIONS.ADMIN_FULL);
  let stepOrder: number | null = null;

  if (!request.route) {
    if (!isAdmin && !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE)) {
      redirect(`/payment-requests?error=${encodeURIComponent("Недостаточно прав для согласования этой заявки")}`);
    }
  } else {
    stepOrder = request.currentStep;
    const requiredRoleId = roleForStep(
      {
        id: request.route.id,
        priority: request.route.priority,
        minAmount: request.route.minAmount,
        maxAmount: request.route.maxAmount,
        organizationId: request.route.organizationId,
        steps: request.route.steps.map((s) => ({ stepOrder: s.stepOrder, roleId: s.roleId })),
      },
      request.currentStep,
    );
    if (!isAdmin) {
      const hasRole = requiredRoleId
        ? await prisma.userRole.findFirst({ where: { userId: session.userId, roleId: requiredRoleId } })
        : null;
      if (!hasRole) {
        redirect(`/payment-requests?error=${encodeURIComponent("Вы не назначены согласующим на этом шаге маршрута")}`);
      }
    }
  }

  const before = request;
  const isFinal =
    !request.route ||
    isFinalStep(
      {
        id: request.route.id,
        priority: request.route.priority,
        minAmount: request.route.minAmount,
        maxAmount: request.route.maxAmount,
        organizationId: request.route.organizationId,
        steps: request.route.steps.map((s) => ({ stepOrder: s.stepOrder, roleId: s.roleId })),
      },
      request.currentStep,
    );

  const nextStatus =
    decision === "rejected" ? PaymentRequestStatus.REJECTED : isFinal ? PaymentRequestStatus.APPROVED : PaymentRequestStatus.PENDING_APPROVAL;

  const updated = await prisma.paymentRequest.update({
    where: { id },
    data: {
      status: nextStatus,
      currentStep: decision === "approved" && !isFinal ? request.currentStep + 1 : request.currentStep,
    },
  });

  await prisma.paymentRequestApproval.create({
    data: { paymentRequestId: id, approverId: session.userId, decision, stepOrder },
  });

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action: decision === "approved" ? "approve_step" : "reject_step",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/payment-requests");
  revalidatePath("/payment-calendar");
}

export async function approvePaymentRequestAction(id: string) {
  await decideStep(id, "approved");
}

export async function rejectPaymentRequestAction(id: string) {
  await decideStep(id, "rejected");
}

export async function markPaymentRequestPaidAction(id: string) {
  await transition(id, PaymentRequestStatus.PAID, "mark_paid");
}

export async function cancelPaymentRequestAction(id: string) {
  await transition(id, PaymentRequestStatus.CANCELLED, "cancel");
}
