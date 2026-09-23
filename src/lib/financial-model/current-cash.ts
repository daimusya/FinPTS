import { prisma } from "@/lib/db";
import { sumMoney } from "@/lib/money";
import { bankTransactionScopeWhere, type AccessScope } from "@/lib/access-scope";

/** Текущий фактический остаток денег — стартовая точка прогноза сценария. */
export async function getCurrentCashBalance(scope: AccessScope): Promise<number> {
  const transactions = await prisma.bankTransaction.findMany({
    where: bankTransactionScopeWhere(scope),
    select: { amount: true, direction: true },
  });
  const inflow = sumMoney(transactions.filter((t) => t.direction === "INFLOW").map((t) => t.amount));
  const outflow = sumMoney(transactions.filter((t) => t.direction === "OUTFLOW").map((t) => t.amount));
  return inflow.minus(outflow).toNumber();
}
