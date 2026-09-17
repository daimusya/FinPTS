"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate } from "@/lib/period";
import { recomputeAccrualDocumentStatus, recomputeBankTransactionStatus } from "@/lib/matching";
import { toDecimal } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { computeFingerprint } from "@/lib/bank-import/fingerprint";

export async function createBankTransactionAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const bankAccountId = String(formData.get("bankAccountId") ?? "") || null;
  const cashAccountId = String(formData.get("cashAccountId") ?? "") || null;
  const operationDateRaw = String(formData.get("operationDate") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim() || null;
  const counterpartyId = String(formData.get("counterpartyId") ?? "") || null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const costCenterId = String(formData.get("costCenterId") ?? "") || null;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const productServiceId = String(formData.get("productServiceId") ?? "") || null;
  const isTransfer = formData.get("isTransfer") === "on";

  if ((!bankAccountId && !cashAccountId) || (bankAccountId && cashAccountId)) {
    redirect(`/cash/transactions/new?error=${encodeURIComponent("Выберите либо банковский счёт, либо кассу")}`);
  }
  if (!operationDateRaw || !direction || !amountRaw || Number(amountRaw) <= 0) {
    redirect(`/cash/transactions/new?error=${encodeURIComponent("Заполните дату, направление и сумму")}`);
  }

  const operationDate = new Date(operationDateRaw);
  await assertPeriodOpenForDate(operationDate).catch((e) => {
    redirect(`/cash/transactions/new?error=${encodeURIComponent((e as Error).message)}`);
  });

  const fingerprint = computeFingerprint({
    bankAccountId: bankAccountId ?? cashAccountId ?? "manual",
    operationDate,
    direction: direction as "INFLOW" | "OUTFLOW",
    amount: toDecimal(amountRaw).toFixed(2),
    purpose,
  });

  const existing = await prisma.bankTransaction.findUnique({ where: { fingerprint } });
  if (existing) {
    redirect(`/cash/transactions/new?error=${encodeURIComponent("Такая операция уже существует (защита от повторного ввода)")}`);
  }

  const created = await prisma.bankTransaction.create({
    data: {
      bankAccountId,
      cashAccountId,
      operationDate,
      direction: direction as never,
      amount: amountRaw,
      purpose,
      counterpartyId,
      cashFlowArticleId,
      departmentId,
      costCenterId,
      projectId,
      productServiceId,
      isTransfer,
      fingerprint,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "bank_transaction",
    entityId: created.id,
    action: "create_manual",
    after: created as never,
  });

  revalidatePath("/cash/transactions");
  redirect(`/cash/transactions/${created.id}`);
}

export async function updateTransactionClassificationAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const before = await prisma.bankTransaction.findUniqueOrThrow({ where: { id } });

  const counterpartyId = String(formData.get("counterpartyId") ?? "") || null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const costCenterId = String(formData.get("costCenterId") ?? "") || null;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const productServiceId = String(formData.get("productServiceId") ?? "") || null;
  const isTransfer = formData.get("isTransfer") === "on";

  const updated = await prisma.bankTransaction.update({
    where: { id },
    data: {
      counterpartyId,
      cashFlowArticleId,
      departmentId,
      costCenterId,
      projectId,
      productServiceId,
      isTransfer,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "bank_transaction",
    entityId: id,
    action: "classify",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/cash/transactions");
  revalidatePath(`/cash/transactions/${id}`);
  redirect(`/cash/transactions/${id}`);
}

export async function allocatePaymentAction(transactionId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const accrualDocumentId = String(formData.get("accrualDocumentId") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  if (!accrualDocumentId || !amountRaw || Number(amountRaw) <= 0) {
    redirect(`/cash/transactions/${transactionId}?error=${encodeURIComponent("Выберите документ и укажите сумму сопоставления")}`);
  }

  const document = await prisma.accrualDocument.findUniqueOrThrow({ where: { id: accrualDocumentId } });
  await assertPeriodOpenForDate(document.date).catch((e) => {
    redirect(`/cash/transactions/${transactionId}?error=${encodeURIComponent((e as Error).message)}`);
  });

  const allocation = await prisma.paymentAllocation.create({
    data: { bankTransactionId: transactionId, accrualDocumentId, amount: amountRaw },
  });

  await Promise.all([
    recomputeAccrualDocumentStatus(accrualDocumentId),
    recomputeBankTransactionStatus(transactionId),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "payment_allocation",
    entityId: allocation.id,
    action: "create",
    after: allocation as never,
    accrualDocumentId,
  });

  revalidatePath(`/cash/transactions/${transactionId}`);
  revalidatePath(`/accruals/${accrualDocumentId}`);
  revalidatePath("/cash/transactions");
  revalidatePath("/accruals");
  redirect(`/cash/transactions/${transactionId}`);
}

export async function cancelAllocationAction(allocationId: string) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const allocation = await prisma.paymentAllocation.findUniqueOrThrow({ where: { id: allocationId } });
  const updated = await prisma.paymentAllocation.update({
    where: { id: allocationId },
    data: { cancelledAt: new Date() },
  });

  await Promise.all([
    recomputeAccrualDocumentStatus(allocation.accrualDocumentId),
    recomputeBankTransactionStatus(allocation.bankTransactionId),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "payment_allocation",
    entityId: allocationId,
    action: "cancel",
    before: allocation as never,
    after: updated as never,
    accrualDocumentId: allocation.accrualDocumentId,
  });

  revalidatePath(`/cash/transactions/${allocation.bankTransactionId}`);
  revalidatePath(`/accruals/${allocation.accrualDocumentId}`);
  revalidatePath("/cash/transactions");
  revalidatePath("/accruals");
}
