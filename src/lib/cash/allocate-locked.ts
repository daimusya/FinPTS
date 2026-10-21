import { prisma } from "@/lib/db";
import { sumMoney } from "@/lib/money";
import { allocationTransactionSide, type AllocationAmounts } from "@/lib/accruals/currency";
import { checkAllocation } from "@/lib/cash/allocation";

/**
 * Записать сопоставление оплаты с документом, проверив несопоставленный
 * остаток операции ещё раз под блокировкой её записи: иначе два
 * сопоставления одновременно (два пользователя, две вкладки) оба уложились бы
 * в один и тот же остаток и вместе превысили бы сумму, прошедшую по счёту.
 */
export async function createAllocationLocked(input: {
  transaction: { id: string; direction: "INFLOW" | "OUTFLOW"; isTransfer: boolean; amount: { toString(): string } };
  accrualDocumentId: string;
  documentDirection: "INCOME" | "EXPENSE";
  /** Введённая сумма — в валюте счёта операции, как её проверяет checkAllocation. */
  entered: string;
  currency: string;
  amounts: AllocationAmounts;
}) {
  return prisma.$transaction(async (db) => {
    // The operation, then the document (cancelling a document takes the same lock): one is never cancelled under a payment.
    await db.$queryRaw`SELECT "id" FROM "bank_transactions" WHERE "id" = ${input.transaction.id} FOR UPDATE`;
    await db.$queryRaw`SELECT "id" FROM "accrual_documents" WHERE "id" = ${input.accrualDocumentId} FOR UPDATE`;
    const [fresh, document] = await Promise.all([
      db.paymentAllocation.findMany({ where: { bankTransactionId: input.transaction.id, cancelledAt: null } }),
      db.accrualDocument.findUniqueOrThrow({ where: { id: input.accrualDocumentId }, select: { status: true } }),
    ]);
    const problem = checkAllocation({
      transactionDirection: input.transaction.direction,
      isTransfer: input.transaction.isTransfer,
      documentDirection: input.documentDirection,
      documentStatus: document.status,
      entered: input.entered,
      transactionAmount: input.transaction.amount.toString(),
      alreadyAllocated: sumMoney(fresh.map(allocationTransactionSide)).toFixed(2),
      currency: input.currency,
    });
    if (problem) return { ok: false as const, problem };
    const created = await db.paymentAllocation.create({
      data: {
        bankTransactionId: input.transaction.id,
        accrualDocumentId: input.accrualDocumentId,
        amount: input.amounts.amount.toFixed(2),
        currencyAmount: input.amounts.currencyAmount?.toFixed(2) ?? null,
        transactionAmount: input.amounts.transactionAmount?.toFixed(2) ?? null,
      },
    });
    return { ok: true as const, created };
  });
}
