import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import type Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import type { ReportFilters } from "./filters";
import { derivePnlTotals, type PnlType } from "./pnl";
import {
  advanceFromTransaction,
  allocatedAsOf,
  assembleBalance,
  linkedFlowEffect,
  type AssembledBalance,
  type BalanceCategory,
} from "./balance-lines";
import { chargesIn } from "./non-cash";
import { loadNonCashCharges, organizationFilter } from "./non-cash-load";
import { accrualScopeWhere, bankTransactionScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";

export type ManagementBalance = AssembledBalance & { asOfDate: Date };

/**
 * Управленческий баланс на дату:
 * — деньги — по банковским и кассовым операциям;
 * — дебиторка и кредиторка — по непогашенным документам начисления, из
 *   кредиторки отдельно выделены зарплата и взносы (документы автопроводки
 *   расчётов зарплаты);
 * — авансы — несопоставленные с документами платежи контрагентам;
 * — займы, капитал, прочие активы и другие статьи без systemCode — по
 *   балансовым операциям и операциям по статьям ДДС, привязанным к ним;
 * — накопленная амортизация и проценты к уплате — начисленное по реестрам
 *   «Основные средства» и «Займы и кредиты» плюс операции по этим статьям;
 * — нераспределённая прибыль — накопленная чистая прибыль по ОПиУ (включая
 *   амортизацию и проценты) плюс балансовые операции по ней (остаток на
 *   начало учёта, дивиденды).
 * Сопоставление платежа с документом действует на дату отчёта, если к ней
 * есть и платёж, и документ (allocatedAsOf): баланс на прошлую дату видит
 * тогдашние долги и авансы, даже если сопоставили их позже.
 */
export async function computeManagementBalance(
  asOfDate: Date,
  filters: ReportFilters,
  scope: AccessScope = UNRESTRICTED_SCOPE,
): Promise<ManagementBalance> {
  const bankAnd: Prisma.BankTransactionWhereInput[] = [{ operationDate: { lte: asOfDate } }];
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
  const accrualAndBase: Prisma.AccrualDocumentWhereInput[] = [{ status: "POSTED", date: { lte: asOfDate } }];
  if (filters.organizationId) accrualAndBase.push({ organizationId: filters.organizationId });
  if (Object.keys(accrualScope).length > 0) accrualAndBase.push(accrualScope);

  // Entries without an organization belong to the company as a whole — only in the unfiltered, unrestricted report.
  const entryWhere: Prisma.BalanceEntryWhereInput = { date: { lte: asOfDate } };
  if (filters.organizationId) entryWhere.organizationId = filters.organizationId;
  else if (scope.organizationIds) entryWhere.organizationId = { in: scope.organizationIds };

  const [transactions, allDocuments, entries, articles, nonCash] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { AND: bankAnd },
      select: {
        amount: true,
        direction: true,
        isTransfer: true,
        counterpartyId: true,
        operationDate: true,
        allocations: {
          where: { cancelledAt: null, accrualDocument: { status: "POSTED" } },
          select: { amount: true, accrualDocument: { select: { date: true } } },
        },
        cashFlowArticle: { select: { balanceArticleId: true, balanceArticle: { select: { category: true } } } },
      },
    }),
    // All posted documents up to the date: one paid today may still have been unpaid on the report date.
    prisma.accrualDocument.findMany({
      where: { AND: accrualAndBase },
      include: {
        lines: { include: { pnlArticle: true } },
        allocations: { where: { cancelledAt: null }, select: { amount: true, bankTransaction: { select: { operationDate: true } } } },
      },
    }),
    prisma.balanceEntry.findMany({ where: entryWhere, select: { balanceArticleId: true, amount: true } }),
    prisma.balanceArticle.findMany({ orderBy: { name: "asc" } }),
    loadNonCashCharges(asOfDate, organizationFilter(filters.organizationId, scope.organizationIds)),
  ]);

  let cash = toDecimal(0);
  let advancesIssued = toDecimal(0);
  let advancesReceived = toDecimal(0);
  const linkedFlows = new Map<string, Decimal>();
  for (const tx of transactions) {
    const amount = toDecimal(tx.amount);
    cash = tx.direction === "INFLOW" ? cash.plus(amount) : cash.minus(amount);
    const linked = tx.cashFlowArticle?.balanceArticleId ?? null;
    if (linked && tx.cashFlowArticle?.balanceArticle && !tx.isTransfer) {
      const effect = linkedFlowEffect(tx.cashFlowArticle.balanceArticle.category as BalanceCategory, tx.direction, amount);
      linkedFlows.set(linked, (linkedFlows.get(linked) ?? toDecimal(0)).plus(effect));
    }
    const advance = advanceFromTransaction({
      direction: tx.direction,
      amount,
      allocated: allocatedAsOf(
        tx.allocations.map((a) => ({ amount: toDecimal(a.amount), paymentDate: tx.operationDate, documentDate: a.accrualDocument.date })),
        asOfDate,
      ),
      hasCounterparty: Boolean(tx.counterpartyId),
      isTransfer: tx.isTransfer,
      linkedToBalance: Boolean(linked),
    });
    advancesIssued = advancesIssued.plus(advance.issued);
    advancesReceived = advancesReceived.plus(advance.received);
  }

  let receivable = toDecimal(0);
  let payable = toDecimal(0);
  let payrollPayable = toDecimal(0);
  for (const doc of allDocuments) {
    const paid = allocatedAsOf(
      doc.allocations.map((a) => ({ amount: toDecimal(a.amount), paymentDate: a.bankTransaction.operationDate, documentDate: doc.date })),
      asOfDate,
    );
    const remaining = sumMoney(doc.lines.map((l) => l.amount)).minus(paid);
    if (remaining.isZero()) continue;
    if (doc.direction === "INCOME") receivable = receivable.plus(remaining);
    else if (doc.sourceSystem === "payroll") payrollPayable = payrollPayable.plus(remaining);
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
  // Depreciation and interest accrued by the date: expenses in the P&L, and lines in the balance.
  let accumulatedDepreciation = toDecimal(0);
  let accruedInterest = toDecimal(0);
  for (const item of nonCash) {
    const amount = chargesIn(item.schedule, null, asOfDate);
    byType[item.pnlArticle.type] = byType[item.pnlArticle.type].plus(amount);
    if (item.kind === "depreciation") accumulatedDepreciation = accumulatedDepreciation.plus(amount);
    else accruedInterest = accruedInterest.plus(amount);
  }
  const accruedBySystemCode = new Map<string, Decimal>([
    ["accumulated_depreciation", accumulatedDepreciation.negated()],
    ["interest_payable", accruedInterest],
  ]);

  const pnlTotals = derivePnlTotals({
    revenue: byType.REVENUE,
    directVariable: byType.DIRECT_VARIABLE,
    directFixed: byType.DIRECT_FIXED,
    indirect: byType.INDIRECT,
    otherIncome: byType.OTHER_INCOME,
    otherExpense: byType.OTHER_EXPENSE,
    tax: byType.TAX,
  });

  const entrySums = new Map<string, Decimal>();
  for (const e of entries) {
    entrySums.set(e.balanceArticleId, (entrySums.get(e.balanceArticleId) ?? toDecimal(0)).plus(toDecimal(e.amount)));
  }
  // Archived articles still count while they carry a balance.
  const visibleArticles = articles.filter(
    (a) => !a.isArchived || entrySums.has(a.id) || linkedFlows.has(a.id) || !(accruedBySystemCode.get(a.systemCode ?? "")?.isZero() ?? true),
  );

  const assembled = assembleBalance({
    cash,
    receivable,
    payable,
    payrollPayable,
    advancesIssued,
    advancesReceived,
    netProfitFromPnl: pnlTotals.netProfit,
    articles: visibleArticles.map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category as BalanceCategory,
      systemCode: a.systemCode,
      entries: entrySums.get(a.id) ?? toDecimal(0),
      linkedFlows: linkedFlows.get(a.id) ?? toDecimal(0),
      accrued: accruedBySystemCode.get(a.systemCode ?? ""),
    })),
  });

  return { asOfDate, ...assembled };
}
