"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { PaymentRequestStatus } from "@prisma/client";

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
  [PaymentRequestStatus.APPROVED]: PERMISSIONS.PAYMENT_REQUEST_APPROVE,
  [PaymentRequestStatus.REJECTED]: PERMISSIONS.PAYMENT_REQUEST_APPROVE,
  [PaymentRequestStatus.CANCELLED]: PERMISSIONS.PAYMENT_REQUEST_APPROVE,
  [PaymentRequestStatus.PAID]: PERMISSIONS.CASH_MANAGE,
};

async function transition(id: string, status: PaymentRequestStatus, action: string, comment?: string) {
  const session = await requirePermission(TRANSITION_PERMISSION[status]);

  const before = await prisma.paymentRequest.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.paymentRequest.update({ where: { id }, data: { status } });

  if (comment !== undefined) {
    await prisma.paymentRequestApproval.create({
      data: {
        paymentRequestId: id,
        approverId: session.userId,
        decision: status === PaymentRequestStatus.APPROVED ? "approved" : "rejected",
        comment,
      },
    });
  }

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

export async function approvePaymentRequestAction(id: string) {
  await transition(id, PaymentRequestStatus.APPROVED, "approve", "");
}

export async function rejectPaymentRequestAction(id: string) {
  await transition(id, PaymentRequestStatus.REJECTED, "reject", "");
}

export async function markPaymentRequestPaidAction(id: string) {
  await transition(id, PaymentRequestStatus.PAID, "mark_paid");
}

export async function cancelPaymentRequestAction(id: string) {
  await transition(id, PaymentRequestStatus.CANCELLED, "cancel");
}
