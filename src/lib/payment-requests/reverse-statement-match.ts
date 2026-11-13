import type { PaymentRequestStatus, Prisma } from "@prisma/client";

type StatementPart = {
  id: string;
  paymentRequestId: string;
  paidAt: Date | null;
  paymentRequest: { status: PaymentRequestStatus };
};

/** Снимает связь и отметку об оплате, если её поставило удаляемое сопоставление. */
export async function reverseStatementMatch(
  db: Prisma.TransactionClient,
  part: StatementPart,
  bankTransactionId: string,
  userId: string,
  action: "unmatch_statement_part" | "unmatch_deleted_statement_part",
) {
  const status = part.paymentRequest.status;
  // Statement settlements record the exact debit for each part. A later
  // independent payment of the whole request must be preserved.
  const paidEvent = part.paidAt ? await db.auditLog.findFirst({
    where: { entityType: "payment_request", entityId: part.paymentRequestId, action: { in: ["mark_paid_from_statement", "mark_paid"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { action: true, afterJson: true },
  }) : null;
  const details = paidEvent?.afterJson;
  const payments = details && typeof details === "object" && !Array.isArray(details) ? details.payments : null;
  const paidByThisDebit = paidEvent?.action === "mark_paid_from_statement" && Array.isArray(payments) &&
    payments.some((payment) => payment && typeof payment === "object" && !Array.isArray(payment) &&
      payment.partId === part.id && payment.bankTransactionId === bankTransactionId);
  const reopen = status === "PAID" && (!part.paidAt || paidByThisDebit);

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
}
