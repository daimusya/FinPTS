import { prisma } from "./db";
import { sumMoney, toDecimal } from "./money";
import { PaymentStatus, BankTransactionMatchStatus } from "@prisma/client";

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

  const total = sumMoney(document.lines.map((l) => l.amount));
  const allocated = sumMoney(allocations.map((a) => a.amount));
  const paymentStatus = computePaymentStatus(total.toString(), allocated.toString());

  await prisma.accrualDocument.update({
    where: { id: documentId },
    data: { paymentStatus },
  });

  return { total, allocated, paymentStatus };
}

export async function recomputeBankTransactionStatus(transactionId: string) {
  const [transaction, allocations] = await Promise.all([
    prisma.bankTransaction.findUniqueOrThrow({ where: { id: transactionId } }),
    prisma.paymentAllocation.findMany({
      where: { bankTransactionId: transactionId, cancelledAt: null },
    }),
  ]);

  const allocated = sumMoney(allocations.map((a) => a.amount));
  const matchStatus = computeMatchStatus(transaction.amount.toString(), allocated.toString());

  await prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { matchStatus },
  });

  return { allocated, matchStatus };
}
