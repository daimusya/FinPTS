"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bankTransactionScopeWhere, getAccessScope, paymentRequestScopeWhere } from "@/lib/access-scope";
import { normalizeCurrency } from "@/lib/currency";
import { parseDateParam } from "@/lib/date-param";
import { prisma } from "@/lib/db";
import { isUniqueViolation } from "@/lib/dictionaries/errors";
import { localDateKey } from "@/lib/payment-calendar";
import { canMatchStatementSlot } from "@/lib/payment-requests/statement-check";
import { settleSchedulesFromStatement } from "@/lib/payment-requests/settle-from-statement";
import { reverseStatementMatch } from "@/lib/payment-requests/reverse-statement-match";
import { PERMISSIONS } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";

const PAGE = "/payment-requests/statement-check";

function statementFilters(formData: FormData) {
  const query = new URLSearchParams();
  for (const key of ["from", "to", "org"]) {
    const value = String(formData.get(key) ?? "");
    if (value && (key === "org" || parseDateParam(value))) query.set(key, value);
  }
  return query;
}

function revalidateStatementMatch(requestId: string) {
  revalidatePath(PAGE);
  revalidatePath("/payment-calendar");
  revalidatePath("/payment-requests");
  revalidatePath(`/payment-requests/${requestId}`);
}

export async function matchStatementPartAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const scope = await getAccessScope(session);
  const transactionId = String(formData.get("transactionId") ?? "");
  const partId = String(formData.get("partId") ?? "");
  const query = statementFilters(formData);
  const partScope = { paymentRequest: paymentRequestScopeWhere(scope) };
  const result = await prisma.$transaction(async (db) => {
    const target = await db.paymentRequestPart.findFirst({ where: { id: partId, ...partScope }, select: { paymentRequestId: true } });
    if (!target) return { error: "Часть заявки недоступна" };
    await db.$queryRaw`SELECT id FROM payment_requests WHERE id = ${target.paymentRequestId} FOR NO KEY UPDATE`;
    await db.$queryRaw`SELECT id FROM bank_transactions WHERE id = ${transactionId} FOR NO KEY UPDATE`;
    const [part, tx] = await Promise.all([
      db.paymentRequestPart.findFirst({ where: { id: partId, ...partScope }, include: { paymentRequest: true } }),
      db.bankTransaction.findFirst({
        where: { ...bankTransactionScopeWhere(scope), id: transactionId, batchId: { not: null }, direction: "OUTFLOW", isTransfer: false },
        include: { bankAccount: true, matchedRequestPart: { select: { id: true } } },
      }),
    ]);
    if (!part || !tx?.bankAccount || !tx.counterpartyId || tx.operationDate.toISOString().slice(0, 10) > localDateKey()) {
      return { error: "Списание или часть заявки недоступны" };
    }
    const matched = { requestId: part.paymentRequestId, bankAccountId: tx.bankAccount.id, counterpartyId: tx.counterpartyId };
    if (part.statementTransactionId === tx.id) return matched;
    if (tx.matchedRequestPart || part.statementTransactionId) return { error: "Списание или часть уже сопоставлены" };
    if (part.paidAt || part.paymentRequest.status !== "APPROVED" || !canMatchStatementSlot({
      ...tx, counterpartyId: tx.counterpartyId, organizationId: tx.bankAccount.organizationId, currency: normalizeCurrency(tx.bankAccount.currency),
    }, part.paymentRequest, part)) return { error: "Списание больше не подходит к выбранной части" };

    await db.paymentRequestPart.update({ where: { id: partId }, data: { statementTransactionId: transactionId } });
    if (tx.requiresManualRequestMatch) await db.bankTransaction.update({ where: { id: tx.id }, data: { requiresManualRequestMatch: false } });
    await db.auditLog.create({ data: {
      userId: session.userId, entityType: "payment_request", entityId: part.paymentRequestId,
      action: "match_statement_part", afterJson: { partId, bankTransactionId: transactionId },
    } });
    return matched;
  }).catch((error: unknown) => {
    if (isUniqueViolation(error)) return { error: "Списание уже сопоставлено" };
    throw error;
  });
  if ("error" in result) query.set("error", result.error);
  else {
    await settleSchedulesFromStatement(result.bankAccountId, new Map([[transactionId, result.counterpartyId]]), session.userId);
    revalidateStatementMatch(result.requestId);
    query.set("notice", "Списание сопоставлено с выбранной частью заявки");
  }
  redirect(`${PAGE}?${query}`);
}

export async function unmatchStatementPartAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const scope = await getAccessScope(session);
  const transactionId = String(formData.get("transactionId") ?? "");
  const partId = String(formData.get("partId") ?? "");
  const query = statementFilters(formData);
  const partScope = { paymentRequest: paymentRequestScopeWhere(scope) };

  const result = await prisma.$transaction(async (db) => {
    const target = await db.paymentRequestPart.findFirst({ where: { id: partId, ...partScope }, select: { paymentRequestId: true } });
    if (!target) return null;
    const requestId = target.paymentRequestId;
    await db.$queryRaw`SELECT id FROM payment_requests WHERE id = ${requestId} FOR NO KEY UPDATE`;
    await db.$queryRaw`SELECT id FROM bank_transactions WHERE id = ${transactionId} FOR NO KEY UPDATE`;
    const [part, tx] = await Promise.all([
      db.paymentRequestPart.findFirst({ where: { id: partId, ...partScope }, include: { paymentRequest: { select: { status: true } } } }),
      db.bankTransaction.findFirst({ where: { ...bankTransactionScopeWhere(scope), id: transactionId }, select: { id: true } }),
    ]);
    if (!part || !tx || part.statementTransactionId !== tx.id) return null;

    await db.bankTransaction.update({ where: { id: tx.id }, data: { requiresManualRequestMatch: true } });
    await reverseStatementMatch(db, part, tx.id, session.userId, "unmatch_statement_part");
    return { requestId };
  });

  if (!result) query.set("error", "Ручное сопоставление уже отменено или недоступно");
  else {
    revalidateStatementMatch(result.requestId);
    query.set("notice", "Сопоставление отменено. Списание снова доступно для ручной сверки");
  }
  redirect(`${PAGE}?${query}`);
}
