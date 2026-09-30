import { prisma } from "./db";
import { sumMoney, toDecimal } from "./money";
import { PaymentStatus, BankTransactionMatchStatus } from "@prisma/client";
import { enqueueOutboxEvent } from "./integrations/outbox";
import { enqueueProjectResultsForDocument } from "./integrations/project-results";
import { allocationDocumentSide, allocationTransactionSide, documentTotal, isForeign } from "./accruals/currency";

export function computePaymentStatus(total: number | string, allocated: number | string): PaymentStatus {
  const t = toDecimal(total);
  const a = toDecimal(allocated);
  if (a.lessThanOrEqualTo(0)) return PaymentStatus.UNPAID;
  if (a.equals(t)) return PaymentStatus.PAID;
  if (a.greaterThan(t)) return PaymentStatus.OVERPAID;
  return PaymentStatus.PARTIALLY_PAID;
}

export function computeMatchStatus(total: number | string, allocated: number | string): BankTransactionMatchStatus {
  const t = toDecimal(total);
  const a = toDecimal(allocated);
  if (a.lessThanOrEqualTo(0)) return BankTransactionMatchStatus.UNMATCHED;
  if (a.greaterThanOrEqualTo(t)) return BankTransactionMatchStatus.MATCHED;
  return BankTransactionMatchStatus.PARTIALLY_MATCHED;
}

export async function recomputeAccrualDocumentStatus(documentId: string) {
  const [document, allocations] = await Promise.all([
    prisma.accrualDocument.findUniqueOrThrow({
      where: { id: documentId },
      include: { lines: true },
    }),
    prisma.paymentAllocation.findMany({
      where: { accrualDocumentId: documentId, cancelledAt: null },
    }),
  ]);

  // A document in a foreign currency is paid when its currency amount is covered, whatever the rouble rate did.
  const foreign = isForeign(document.currency);
  const total = documentTotal(document.lines, foreign);
  const allocated = sumMoney(allocations.map(allocationDocumentSide));
  const paymentStatus = computePaymentStatus(total.toString(), allocated.toString());

  await prisma.accrualDocument.update({
    where: { id: documentId },
    data: { paymentStatus },
  });

  // Только подтверждённые финансовые события уходят в Битрикс24: смена
  // статуса оплаты проведённого документа. idempotencyKey включает сумму
  // сопоставления, поэтому повтор с тем же состоянием не создаёт дубль.
  if (document.status === "POSTED") {
    const isOverdue = Boolean(document.dueDate && document.dueDate < new Date() && paymentStatus !== "PAID");
    await enqueueOutboxEvent({
      eventType: "payment_status_changed",
      targetSystem: "BITRIX24",
      idempotencyKey: `payment_status:${documentId}:${paymentStatus}:${allocated.toFixed(2)}`,
      payload: {
        accrualDocumentId: documentId,
        documentNumber: document.number,
        counterpartyId: document.counterpartyId,
        paymentStatus,
        currency: document.currency,
        totalAmount: total.toFixed(2),
        allocatedAmount: allocated.toFixed(2),
        outstandingAmount: total.minus(allocated).toFixed(2),
        dueDate: document.dueDate?.toISOString() ?? null,
        isOverdue,
        documentUrl: `/accruals/${documentId}`,
      },
    });
    // Payments change the money side of the document's projects (received / outstanding).
    await enqueueProjectResultsForDocument(documentId);
  }

  return { total, allocated, paymentStatus };
}

export async function recomputeBankTransactionStatus(transactionId: string) {
  const [transaction, allocations] = await Promise.all([
    prisma.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } }),
    prisma.paymentAllocation.findMany({
      where: { bankTransactionId: transactionId, cancelledAt: null },
    }),
  ]);

  // In the currency of the operation's account.
  const allocated = sumMoney(allocations.map(allocationTransactionSide));
  const matchStatus = computeMatchStatus(transaction.amount.toString(), allocated.toString());

  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { matchStatus },
  });

  return { allocated, matchStatus };
}
