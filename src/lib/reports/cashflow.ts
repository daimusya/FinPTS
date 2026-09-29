import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import type Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import type { ReportFilters } from "./filters";
import type { ReportPeriod } from "./period";
import { bankTransactionScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";
import { addNative, BASE_CURRENCY, revalueBalances, transactionCurrency, type RateLookup } from "@/lib/currency";
import { loadRateLookup } from "@/lib/currency-rates";

function buildWhere(filters: ReportFilters, scope: AccessScope): Prisma.BankTransactionWhereInput {
  const and: Prisma.BankTransactionWhereInput[] = [];
  if (filters.departmentId) and.push({ departmentId: filters.departmentId });
  if (filters.costCenterId) and.push({ costCenterId: filters.costCenterId });
  if (filters.projectId) and.push({ projectId: filters.projectId });
  if (filters.productServiceId) and.push({ productServiceId: filters.productServiceId });
  if (filters.counterpartyId) and.push({ counterpartyId: filters.counterpartyId });
  if (filters.organizationId) {
    and.push({
      OR: [
        { bankAccount: { organizationId: filters.organizationId } },
        { cashAccount: { organizationId: filters.organizationId } },
      ],
    });
  }
  const scopeWhere = bankTransactionScopeWhere(scope);
  if (Object.keys(scopeWhere).length > 0) and.push(scopeWhere);
  return and.length > 0 ? { AND: and } : {};
}

export interface CashFlowArticleRow {
  articleId: string | null;
  articleName: string;
  amount: Decimal;
  transactionIds: string[];
}

export interface CurrencyBalance {
  currency: string;
  opening: Decimal;
  closing: Decimal;
}

export interface CashFlowReport {
  openingBalance: Decimal;
  inflowRows: CashFlowArticleRow[];
  outflowRows: CashFlowArticleRow[];
  totalInflow: Decimal;
  totalOutflow: Decimal;
  transfersNet: Decimal;
  netFlow: Decimal;
  /** Переоценка валютных остатков: остаток на конец по курсу на конец минус (начало по курсу на начало + движения по курсам своих дат). */
  fxDifference: Decimal;
  closingBalance: Decimal;
  /** Остатки валютных счетов в их валюте (без рублёвых). */
  currencyBalances: CurrencyBalance[];
  /** «USD на 01.03.2026» — курса нет, сумма взята по ближайшему или как есть. */
  missingRates: string | null;
}

function groupByArticle(
  transactions: Array<{ id: string; amount: Decimal; cashFlowArticleId: string | null; cashFlowArticle: { name: string } | null }>,
): CashFlowArticleRow[] {
  const map = new Map<string, CashFlowArticleRow>();
  for (const tx of transactions) {
    const key = tx.cashFlowArticleId ?? "__none__";
    const row = map.get(key) ?? {
      articleId: tx.cashFlowArticleId,
      articleName: tx.cashFlowArticle?.name ?? "Без статьи",
      amount: toDecimal(0),
      transactionIds: [],
    };
    row.amount = row.amount.plus(toDecimal(tx.amount));
    row.transactionIds.push(tx.id);
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.amount.comparedTo(a.amount));
}

export async function computeCashFlowReport(
  period: ReportPeriod,
  filters: ReportFilters,
  scope: AccessScope = UNRESTRICTED_SCOPE,
  rates?: RateLookup,
): Promise<CashFlowReport> {
  const where = buildWhere(filters, scope);
  const accountCurrency = { bankAccount: { select: { currency: true } }, cashAccount: { select: { currency: true } } } as const;

  const [openingTx, rawPeriodTx, lookup] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { ...where, operationDate: { lt: period.from } },
      select: { amount: true, direction: true, ...accountCurrency },
    }),
    prisma.bankTransaction.findMany({
      where: { ...where, operationDate: { gte: period.from, lte: period.to } },
      include: { cashFlowArticle: true, ...accountCurrency },
    }),
    rates ? Promise.resolve(rates) : loadRateLookup(),
  ]);

  // Opening balances per currency, valued at the rate of the day before the period (the previous period's closing).
  const openingNative = new Map<string, Decimal>();
  for (const t of openingTx) {
    const amount = toDecimal(t.amount);
    addNative(openingNative, transactionCurrency(t), t.direction === "INFLOW" ? amount : amount.negated());
  }
  const dayBefore = new Date(Date.UTC(period.from.getUTCFullYear(), period.from.getUTCMonth(), period.from.getUTCDate() - 1));
  const openingBalance = revalueBalances(openingNative, dayBefore, lookup);

  // Every operation in rubles at the rate of its own date.
  const closingNative = new Map(openingNative);
  const periodTx = rawPeriodTx.map((t) => {
    const currency = transactionCurrency(t);
    const native = toDecimal(t.amount);
    addNative(closingNative, currency, t.direction === "INFLOW" ? native : native.negated());
    return { ...t, amount: lookup.toRub(native, currency, t.operationDate) };
  });

  const transfers = periodTx.filter((t) => t.isTransfer);
  const operating = periodTx.filter((t) => !t.isTransfer);

  const inflowRows = groupByArticle(operating.filter((t) => t.direction === "INFLOW"));
  const outflowRows = groupByArticle(operating.filter((t) => t.direction === "OUTFLOW"));

  const totalInflow = sumMoney(inflowRows.map((r) => r.amount));
  const totalOutflow = sumMoney(outflowRows.map((r) => r.amount));

  const transfersInflow = sumMoney(transfers.filter((t) => t.direction === "INFLOW").map((t) => t.amount));
  const transfersOutflow = sumMoney(transfers.filter((t) => t.direction === "OUTFLOW").map((t) => t.amount));
  const transfersNet = transfersInflow.minus(transfersOutflow);

  const netFlow = totalInflow.minus(totalOutflow).plus(transfersNet);
  const closingBalance = revalueBalances(closingNative, period.to, lookup);
  const fxDifference = closingBalance.minus(openingBalance).minus(netFlow);
  const currencyBalances = [...new Set([...openingNative.keys(), ...closingNative.keys()])]
    .filter((c) => c !== BASE_CURRENCY)
    .sort()
    .map((currency) => ({ currency, opening: openingNative.get(currency) ?? toDecimal(0), closing: closingNative.get(currency) ?? toDecimal(0) }));

  return {
    openingBalance,
    inflowRows,
    outflowRows,
    totalInflow,
    totalOutflow,
    transfersNet,
    netFlow,
    fxDifference,
    closingBalance,
    currencyBalances,
    missingRates: lookup.missingText(),
  };
}
