"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, requireSession, hasPermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { PaymentRequestStatus } from "@prisma/client";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payment-requests/labels";
import { parseAccountKey } from "@/lib/payment-calendar";
import { readScheduleRows } from "@/lib/payment-requests/parts";
import {
  assignPaymentAccount,
  markPartPaid,
  markRemainingPartsPaid,
  removePaymentSchedule,
  rescheduleRequest,
  savePaymentSchedule,
  type PlanResult,
} from "@/lib/payment-plan/service";
import {
  selectApprovalRoute,
  roleForStep,
  isFinalStep,
  parseDecisionComment,
  type ApprovalDecision,
  type ApprovalRouteCandidate,
} from "@/lib/payment-requests/approval";

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

  const payAccountRaw = String(formData.get("payAccount") ?? "");
  const payAccount = payAccountRaw ? parseAccountKey(payAccountRaw) : { bankAccountId: null, cashAccountId: null };
  if (!payAccount) redirect(`/payment-requests/new?error=${encodeURIComponent("Выберите счёт или кассу оплаты из списка")}`);
  const accountOrg = payAccount!.bankAccountId
    ? (await prisma.bankAccount.findUnique({ where: { id: payAccount!.bankAccountId } }))?.organizationId
    : payAccount!.cashAccountId
      ? (await prisma.cashAccount.findUnique({ where: { id: payAccount!.cashAccountId } }))?.organizationId
      : organizationId;
  if (accountOrg !== organizationId) {
    redirect(`/payment-requests/new?error=${encodeURIComponent("Счёт оплаты должен принадлежать организации заявки")}`);
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
      payBankAccountId: payAccount!.bankAccountId,
      payCashAccountId: payAccount!.cashAccountId,
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

const TRANSITION_FROM: Partial<Record<PaymentRequestStatus, PaymentRequestStatus[]>> = {
  [PaymentRequestStatus.CANCELLED]: [PaymentRequestStatus.PENDING_APPROVAL, PaymentRequestStatus.APPROVED],
  [PaymentRequestStatus.PAID]: [PaymentRequestStatus.APPROVED],
};

async function transition(id: string, status: PaymentRequestStatus, action: string, formData?: FormData) {
  const session = await requirePermission(TRANSITION_PERMISSION[status]);

  const before = await prisma.paymentRequest.findUniqueOrThrow({ where: { id } });
  // A stale page must not mark a cancelled request as paid or cancel a paid one.
  const allowedFrom = TRANSITION_FROM[status] ?? [];
  const moved = await prisma.$transaction(async (db) => {
    const result = await db.paymentRequest.updateMany({ where: { id, status: { in: allowedFrom } }, data: { status } });
    if (result.count > 0 && status === PaymentRequestStatus.PAID) await markRemainingPartsPaid(db, id, session.userId);
    return result;
  });
  if (moved.count === 0) {
    const backTo = formData?.get("returnTo") === "detail" ? `/payment-requests/${id}` : "/payment-requests";
    redirect(`${backTo}?error=${encodeURIComponent(`Заявка уже в статусе «${PAYMENT_REQUEST_STATUS_LABELS[before.status]}» — действие не выполнено`)}`);
  }
  const updated = await prisma.paymentRequest.findUniqueOrThrow({ where: { id } });

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action,
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/payment-requests");
  revalidatePath(`/payment-requests/${id}`);
  revalidatePath("/payment-calendar");
  if (formData?.get("returnTo") === "detail") redirect(`/payment-requests/${id}`);
}

/**
 * Согласование/отклонение шага маршрута. Заявка без маршрута (routeId
 * null) идёт по старому одноступенчатому согласованию — нужно общее право
 * payment_requests.approve. Заявка с маршрутом требует членства именно в
 * роли текущего шага (или admin.full в обход) — так «Руководитель
 * подразделения» может согласовать свой шаг, даже не имея этого общего
 * права.
 */
async function decideStep(id: string, decision: ApprovalDecision, formData: FormData) {
  const session = await requireSession();
  // Decisions come from the request page or from the list; errors go back to the same place.
  const backTo = formData.get("returnTo") === "detail" ? `/payment-requests/${id}` : "/payment-requests";
  const fail = (message: string): never => redirect(`${backTo}?error=${encodeURIComponent(message)}`);

  const parsedComment = parseDecisionComment(decision, formData.get("comment"));
  if ("error" in parsedComment) fail(parsedComment.error);
  const comment = (parsedComment as { comment: string | null }).comment;

  const request = await prisma.paymentRequest.findUniqueOrThrow({
    where: { id },
    include: { route: { include: { steps: true } } },
  });

  if (request.status !== PaymentRequestStatus.PENDING_APPROVAL) {
    fail("Заявка уже не на согласовании");
  }
  // The page may be stale: someone else could have decided this step meanwhile.
  const expectedStep = Number(formData.get("expectedStep") ?? request.currentStep);
  if (expectedStep !== request.currentStep) {
    fail("По этой заявке уже принято решение на шаге " + expectedStep + " — проверьте историю согласования");
  }

  const isAdmin = hasPermission(session, PERMISSIONS.ADMIN_FULL);
  let stepOrder: number | null = null;

  if (!request.route) {
    if (!isAdmin && !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE)) {
      fail("Недостаточно прав для согласования этой заявки");
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
        fail("Вы не назначены согласующим на этом шаге маршрута");
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

  // Conditional update: only if the request is still on this step, so two approvers
  // pressing the button at once cannot both decide it. The decision is written in the same transaction.
  const decided = await prisma.$transaction(async (db) => {
    const moved = await db.paymentRequest.updateMany({
      where: { id, status: PaymentRequestStatus.PENDING_APPROVAL, currentStep: request.currentStep },
      data: {
        status: nextStatus,
        currentStep: decision === "approved" && !isFinal ? request.currentStep + 1 : request.currentStep,
      },
    });
    if (moved.count === 0) return null;
    await db.paymentRequestApproval.create({
      data: { paymentRequestId: id, approverId: session.userId, decision, stepOrder, comment },
    });
    return db.paymentRequest.findUniqueOrThrow({ where: { id } });
  });
  if (!decided) fail("По этой заявке только что принято другое решение — проверьте историю согласования");
  const updated = decided!;

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action: decision === "approved" ? "approve_step" : "reject_step",
    before: before as never,
    after: { ...updated, decisionComment: comment, decidedStep: stepOrder } as never,
  });

  revalidatePath("/payment-requests");
  revalidatePath(`/payment-requests/${id}`);
  revalidatePath("/payment-calendar");
  if (backTo !== "/payment-requests") redirect(backTo);
}

export async function approvePaymentRequestAction(id: string, formData: FormData) {
  await decideStep(id, "approved", formData);
}

export async function rejectPaymentRequestAction(id: string, formData: FormData) {
  await decideStep(id, "rejected", formData);
}

export async function markPaymentRequestPaidAction(id: string, formData?: FormData) {
  await transition(id, PaymentRequestStatus.PAID, "mark_paid", formData);
}

export async function cancelPaymentRequestAction(id: string, formData?: FormData) {
  await transition(id, PaymentRequestStatus.CANCELLED, "cancel", formData);
}

/** Перенос срока со страницы заявки (форма с датой и причиной). */
export async function reschedulePaymentRequestAction(id: string, formData: FormData) {
  const session = await requireSession();
  const result = await rescheduleRequest(session, id, formData.get("dueDate"), formData.get("reason"));
  backToRequest(id, result);
}

/** График оплаты частями: параллельные поля partId / partDueDate / partAmount. */
export async function savePaymentScheduleAction(id: string, formData: FormData) {
  const session = await requireSession();
  const rows = readScheduleRows(formData.getAll("partId"), formData.getAll("partDueDate"), formData.getAll("partAmount"));
  const result = await savePaymentSchedule(session, id, rows);
  backToRequest(id, result);
}

export async function removePaymentScheduleAction(id: string) {
  const session = await requireSession();
  backToRequest(id, await removePaymentSchedule(session, id));
}

export async function markPaymentPartPaidAction(requestId: string, partId: string) {
  const session = await requireSession();
  backToRequest(requestId, await markPartPaid(session, partId));
}

export async function assignRequestAccountAction(id: string, formData: FormData) {
  const session = await requireSession();
  backToRequest(id, await assignPaymentAccount(session, "request", id, formData.get("payAccount")));
}

function backToRequest(id: string, result: PlanResult): never {
  const param = result.ok ? `notice=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent((result as { error: string }).error)}`;
  redirect(`/payment-requests/${id}?${param}`);
}
