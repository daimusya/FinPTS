import type { PaymentRequestStatus, Prisma } from "@prisma/client";

type StatementPart = {
  id: string;
  paymentRequestId: string;
  paidAt: Date | null;
  statementTransactionId: string | null;
  paymentRequest: { status: PaymentRequestStatus };
};

/** Снимает связь и отметку об оплате, если её поставило удаляемое сопоставление. */
export async function reverseStatementMatch(
  db: Prisma.TransactionClient,
  part: StatementPart,
  debit: { id: string; operationDate: Date },
  userId: string,
  action: "unmatch_statement_part" | "unmatch_deleted_statement_part",
) {
  const bankTransactionId = debit.id;
  const hasLink = part.statementTransactionId === bankTransactionId;
  if (part.statementTransactionId && !hasLink) return false;
  const status = part.paymentRequest.status;
  const paidByThisDebit = part.paidAt !== null &&
    await wasMarkedPaidByDebit(db, part, debit);
  if (!hasLink && !paidByThisDebit) return false;
  const reopen = status === "PAID" && (paidByThisDebit || !part.paidAt);

  await db.paymentRequestPart.update({ where: { id: part.id }, data: {
    statementTransactionId: null,
    ...(paidByThisDebit ? { paidAt: null, paidById: null } : {}),
  } });
  if (reopen) await db.paymentRequest.update({ where: { id: part.paymentRequestId }, data: { status: "APPROVED" } });
  await db.auditLog.create({ data: {
    userId, entityType: "payment_request", entityId: part.paymentRequestId, action,
    beforeJson: { partId: part.id, bankTransactionId, status },
    afterJson: { partId: part.id, bankTransactionId: null, status: reopen ? "APPROVED" : status },
  } });
  return true;
}

async function wasMarkedPaidByDebit(
  db: Prisma.TransactionClient,
  part: StatementPart,
  debit: { id: string; operationDate: Date },
) {
  const events = await db.auditLog.findMany({
    where: {
      entityType: "payment_request", entityId: part.paymentRequestId,
      action: { in: ["mark_paid_from_statement", "mark_paid", "mark_part_paid", "mark_part_paid_final"] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { action: true, afterJson: true },
  });
  for (const { action, afterJson } of events) {
    if (action === "mark_paid") return false;
    if (!afterJson || typeof afterJson !== "object" || Array.isArray(afterJson)) continue;
    if (action !== "mark_paid_from_statement") {
      if (afterJson.partId === part.id) return false;
      continue;
    }
    const payments = afterJson.payments;
    if (!Array.isArray(payments)) continue;
    for (const payment of payments) {
      if (!payment || typeof payment !== "object" || Array.isArray(payment) || payment.partId !== part.id || payment.markedPaid === false) continue;
      // Older audit entries list all matches, including parts that were already
      // paid. Only marks made from a statement use the bank operation's date.
      return payment.bankTransactionId === debit.id &&
        (payment.markedPaid === true || part.paidAt?.getTime() === debit.operationDate.getTime());
    }
  }
  return false;
}
