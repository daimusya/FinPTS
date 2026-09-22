import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import Decimal from "decimal.js";
import type { ReportFilters } from "./filters";
import { derivePnlTotals, type PnlType } from "./pnl";
import { accrualScopeWhere, bankTransactionScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";

export interface ManagementBalance {
  asOfDate: Date;
  cash: Decimal;
  receivable: Decimal;
  advancesIssued: Decimal;
  otherAssets: Decimal;
  totalAssets: Decimal;

  payable: Decimal;
  advancesReceived: Decimal;
  taxesPayrollPayable: Decimal;
  loans: Decimal;
  totalLiabilities: Decimal;

  capital: Decimal;
  retainedEarnings: Decimal;
  totalEquity: Decimal;

  equityImpliedByBalance: Decimal;
  discrepancy: Decimal;
  isBalanced: boolean;
}

/**
 * Управленческий баланс строится из того, что реально учитывается в системе
 * на сегодня: денежные средства (по банковским/кассовым операциям),
 * дебиторская и кредиторская задолженность (по начислениям). Авансы,
 * займы, капитал и прочие активы пока не выделяются отдельно от общей
 * задолженности (нет полноценной двойной записи) — это ограничение
 * зафиксировано явно, а не скрыто нулями без объяснения.
 *
 * Контрольное равенство: капитал+прибыль, подразумеваемые балансом
 * (Активы − Обязательства), сверяются с накопленной чистой прибылью по
 * ОПиУ за всё время. Расхождение — диагностика, а не automatически
 * скрываемая ошибка: оно означает движения денег/задолженности, которые
 * не прошли через документы начисления (или наоборот).
 */
export async function computeManagementBalance(
  asOfDate: Date,
  filters: ReportFilters,
  scope: AccessScope = UNRESTRICTED_SCOPE,
): Promise<ManagementBalance> {
  const bankAnd: Array<Record<string, unknown>> = [{ operationDate: { lte: asOfDate } }];
  if (filters.organizationId) {
    bankAnd.push({
      OR: [
        { bankAccount: { organizationId: filters.organizationId } },
        { cashAccount: { organizationId: filters.organizationId } },
      ],
    });
  }
  const bankScopeWhere = bankTransactionScopeWhere(scope);
  if (Object.keys(bankScopeWhere).length > 0) bankAnd.push(bankScopeWhere);

  const accrualScope = accrualScopeWhere(scope);
  const accrualAndBase: Array<Record<string, unknown>> = [{ status: "POSTED", date: { lte: asOfDate } }];
  if (filters.organizationId) accrualAndBase.push({ organizationId: filters.organizationId });
  if (Object.keys(accrualScope).length > 0) accrualAndBase.push(accrualScope);

  const [transactions, unpaidDocuments, allDocuments] = await Promise.all([
    prisma.bankTransaction.findMany({ where: { AND: bankAnd }, select: { amount: true, direction: true } }),
    prisma.accrualDocument.findMany({
      where: { AND: [...accrualAndBase, { paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID", "OVERPAID"] } }] },
      include: { lines: true, allocations: { where: { cancelledAt: null } } },
    }),
    prisma.accrualDocument.findMany({
      where: { AND: accrualAndBase },
      include: { lines: { include: { pnlArticle: true } } },
    }),
  ]);

  const cash = sumMoney(transactions.filter((t) => t.direction === "INFLOW").map((t) => t.amount)).minus(
    sumMoney(transactions.filter((t) => t.direction === "OUTFLOW").map((t) => t.amount)),
  );

  let receivable = toDecimal(0);
  let payable = toDecimal(0);
  for (const doc of unpaidDocuments) {
    const total = sumMoney(doc.lines.map((l) => l.amount));
    const allocated = sumMoney(doc.allocations.map((a) => a.amount));
    const remaining = total.minus(allocated);
    if (doc.direction === "INCOME") receivable = receivable.plus(remaining);
    else payable = payable.plus(remaining);
  }

  const byType: Record<PnlType, Decimal> = {
    REVENUE: toDecimal(0),
    DIRECT_VARIABLE: toDecimal(0),
    DIRECT_FIXED: toDecimal(0),
    INDIRECT: toDecimal(0),
    OTHER_INCOME: toDecimal(0),
    OTHER_EXPENSE: toDecimal(0),
    TAX: toDecimal(0),
  };
  for (const doc of allDocuments) {
    for (const line of doc.lines) {
      if (!line.pnlArticle) continue;
      const type = line.pnlArticle.type as PnlType;
      byType[type] = byType[type].plus(toDecimal(line.amount));
    }
  }
  const pnlTotals = derivePnlTotals({
    revenue: byType.REVENUE,
    directVariable: byType.DIRECT_VARIABLE,
    directFixed: byType.DIRECT_FIXED,
    indirect: byType.INDIRECT,
    otherIncome: byType.OTHER_INCOME,
    otherExpense: byType.OTHER_EXPENSE,
    tax: byType.TAX,
  });

  const advancesIssued = toDecimal(0);
  const otherAssets = toDecimal(0);
  const advancesReceived = toDecimal(0);
  const taxesPayrollPayable = toDecimal(0);
  const loans = toDecimal(0);
  const capital = toDecimal(0);

  const totalAssets = cash.plus(receivable).plus(advancesIssued).plus(otherAssets);
  const totalLiabilities = payable.plus(advancesReceived).plus(taxesPayrollPayable).plus(loans);
  const equityImpliedByBalance = totalAssets.minus(totalLiabilities);
  const retainedEarnings = pnlTotals.netProfit;
  const totalEquity = capital.plus(retainedEarnings);
  const discrepancy = equityImpliedByBalance.minus(totalEquity);

  return {
    asOfDate,
    cash,
    receivable,
    advancesIssued,
    otherAssets,
    totalAssets,
    payable,
    advancesReceived,
    taxesPayrollPayable,
    loans,
    totalLiabilities,
    capital,
    retainedEarnings,
    totalEquity,
    equityImpliedByBalance,
    discrepancy,
    isBalanced: discrepancy.abs().lessThan(0.01),
  };
}
