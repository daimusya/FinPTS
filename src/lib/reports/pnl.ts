import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import type Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import type { ReportFilters } from "./filters";
import type { ReportPeriod } from "./period";
import { accrualScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";
import { chargesIn } from "./non-cash";
import { loadNonCashCharges, organizationFilter } from "./non-cash-load";
import { lineNetAmount, loadInputVatRule } from "@/lib/accruals/vat";

export const PNL_TYPE_ORDER = [
  "REVENUE",
  "DIRECT_VARIABLE",
  "DIRECT_FIXED",
  "INDIRECT",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
  "TAX",
] as const;

export type PnlType = (typeof PNL_TYPE_ORDER)[number];

export const PNL_TYPE_LABELS: Record<PnlType, string> = {
  REVENUE: "Выручка",
  DIRECT_VARIABLE: "Прямые переменные расходы",
  DIRECT_FIXED: "Прямые постоянные расходы",
  INDIRECT: "Косвенные расходы",
  OTHER_INCOME: "Прочие доходы",
  OTHER_EXPENSE: "Прочие расходы",
  TAX: "Налоги",
};

/** Доходные разделы: перевыполнение плана по ним — хорошо, по остальным (расходам) — плохо. */
export const PNL_INCOME_TYPES: ReadonlySet<PnlType> = new Set(["REVENUE", "OTHER_INCOME"]);

export interface PnlArticleRow {
  articleId: string | null;
  articleName: string;
  amount: Decimal;
  documentIds: string[];
  /** В т.ч. без документов: амортизация основных средств и проценты по займам. */
  nonCash?: Decimal;
}

export interface PnlReport {
  byType: Record<PnlType, { total: Decimal; rows: PnlArticleRow[] }>;
  revenue: Decimal;
  directVariable: Decimal;
  directFixed: Decimal;
  grossProfit: Decimal;
  indirect: Decimal;
  operatingProfit: Decimal;
  otherIncome: Decimal;
  otherExpense: Decimal;
  tax: Decimal;
  netProfit: Decimal;
  grossMarginPct: Decimal | null;
  netMarginPct: Decimal | null;
}

function buildWhere(period: ReportPeriod, filters: ReportFilters, scope: AccessScope): Prisma.AccrualDocumentWhereInput {
  const and: Prisma.AccrualDocumentWhereInput[] = [
    { status: "POSTED", date: { gte: period.from, lte: period.to } },
  ];
  if (filters.organizationId) and.push({ organizationId: filters.organizationId });
  if (filters.counterpartyId) and.push({ counterpartyId: filters.counterpartyId });
  const scopeWhere = accrualScopeWhere(scope);
  if (Object.keys(scopeWhere).length > 0) and.push(scopeWhere);

  const lineFilter: Prisma.AccrualDocumentLineWhereInput = {};
  if (filters.departmentId) lineFilter.departmentId = filters.departmentId;
  if (filters.costCenterId) lineFilter.costCenterId = filters.costCenterId;
  if (filters.projectId) lineFilter.projectId = filters.projectId;
  if (filters.productServiceId) lineFilter.productServiceId = filters.productServiceId;
  if (Object.keys(lineFilter).length > 0) {
    and.push({ lines: { some: lineFilter } });
  }
  return { AND: and };
}

export async function computePnlReport(
  period: ReportPeriod,
  filters: ReportFilters,
  scope: AccessScope = UNRESTRICTED_SCOPE,
): Promise<PnlReport> {
  const vatRule = await loadInputVatRule();
  const documents = await prisma.accrualDocument.findMany({
    where: buildWhere(period, filters, scope),
    include: {
      lines: {
        where: {
          ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
          ...(filters.costCenterId ? { costCenterId: filters.costCenterId } : {}),
          ...(filters.projectId ? { projectId: filters.projectId } : {}),
          ...(filters.productServiceId ? { productServiceId: filters.productServiceId } : {}),
        },
        include: { pnlArticle: true },
      },
    },
  });

  const byType: Record<PnlType, { total: Decimal; rows: PnlArticleRow[] }> = {
    REVENUE: { total: toDecimal(0), rows: [] },
    DIRECT_VARIABLE: { total: toDecimal(0), rows: [] },
    DIRECT_FIXED: { total: toDecimal(0), rows: [] },
    INDIRECT: { total: toDecimal(0), rows: [] },
    OTHER_INCOME: { total: toDecimal(0), rows: [] },
    OTHER_EXPENSE: { total: toDecimal(0), rows: [] },
    TAX: { total: toDecimal(0), rows: [] },
  };

  const rowMaps: Record<PnlType, Map<string, PnlArticleRow>> = {
    REVENUE: new Map(),
    DIRECT_VARIABLE: new Map(),
    DIRECT_FIXED: new Map(),
    INDIRECT: new Map(),
    OTHER_INCOME: new Map(),
    OTHER_EXPENSE: new Map(),
    TAX: new Map(),
  };

  for (const doc of documents) {
    for (const line of doc.lines) {
      if (!line.pnlArticle) continue;
      const type = line.pnlArticle.type as PnlType;
      const map = rowMaps[type];
      const key = line.pnlArticleId ?? "__none__";
      const row = map.get(key) ?? {
        articleId: line.pnlArticleId,
        articleName: line.pnlArticle.name,
        amount: toDecimal(0),
        documentIds: [],
      };
      // Without VAT: the line amount includes it (see lineNetAmount).
      row.amount = row.amount.plus(lineNetAmount(line, doc.direction, vatRule(doc.organizationId, doc.date)));
      if (!row.documentIds.includes(doc.id)) row.documentIds.push(doc.id);
      map.set(key, row);
    }
  }

  for (const { article, amount } of await nonCashByArticle(period, filters, scope)) {
    const map = rowMaps[article.type];
    const row = map.get(article.id) ?? { articleId: article.id, articleName: article.name, amount: toDecimal(0), documentIds: [] };
    row.amount = row.amount.plus(amount);
    row.nonCash = (row.nonCash ?? toDecimal(0)).plus(amount);
    map.set(article.id, row);
  }

  for (const type of PNL_TYPE_ORDER) {
    const rows = Array.from(rowMaps[type].values()).sort((a, b) => b.amount.comparedTo(a.amount));
    byType[type] = { total: sumMoney(rows.map((r) => r.amount)), rows };
  }

  const totals = derivePnlTotals({
    revenue: byType.REVENUE.total,
    directVariable: byType.DIRECT_VARIABLE.total,
    directFixed: byType.DIRECT_FIXED.total,
    indirect: byType.INDIRECT.total,
    otherIncome: byType.OTHER_INCOME.total,
    otherExpense: byType.OTHER_EXPENSE.total,
    tax: byType.TAX.total,
  });

  return { byType, ...totals };
}

/**
 * Амортизация и проценты по займам за период по статьям ОПиУ (без
 * документов, по реестрам). У них нет контрагента, ЦФО, проекта и продукта,
 * а у займа — подразделения: такие фильтры их исключают. Одни правила для
 * ОПиУ и маржинальности.
 */
export async function nonCashByArticle(
  period: ReportPeriod,
  filters: ReportFilters,
  scope: AccessScope = UNRESTRICTED_SCOPE,
): Promise<Array<{ article: { id: string; name: string; type: PnlType }; amount: Decimal }>> {
  if (filters.counterpartyId || filters.costCenterId || filters.projectId || filters.productServiceId) return [];
  const items = await loadNonCashCharges(period.to, organizationFilter(filters.organizationId, scope.organizationIds));
  const result: Array<{ article: { id: string; name: string; type: PnlType }; amount: Decimal }> = [];
  for (const item of items) {
    if (filters.departmentId && item.departmentId !== filters.departmentId) continue;
    const amount = chargesIn(item.schedule, period.from, period.to);
    if (!amount.isZero()) result.push({ article: item.pnlArticle, amount });
  }
  return result;
}

export interface PnlTypeTotals {
  revenue: Decimal;
  directVariable: Decimal;
  directFixed: Decimal;
  indirect: Decimal;
  otherIncome: Decimal;
  otherExpense: Decimal;
  tax: Decimal;
}

/**
 * Pure P&L waterfall math, separated from the DB fetch so it can be unit
 * tested without a database: gross profit -> operating profit -> net profit.
 */
export function derivePnlTotals(t: PnlTypeTotals): Omit<PnlReport, "byType"> {
  const grossProfit = t.revenue.minus(t.directVariable).minus(t.directFixed);
  const operatingProfit = grossProfit.minus(t.indirect);
  const netProfit = operatingProfit.plus(t.otherIncome).minus(t.otherExpense).minus(t.tax);

  return {
    revenue: t.revenue,
    directVariable: t.directVariable,
    directFixed: t.directFixed,
    grossProfit,
    indirect: t.indirect,
    operatingProfit,
    otherIncome: t.otherIncome,
    otherExpense: t.otherExpense,
    tax: t.tax,
    netProfit,
    grossMarginPct: t.revenue.greaterThan(0) ? grossProfit.dividedBy(t.revenue).times(100) : null,
    netMarginPct: t.revenue.greaterThan(0) ? netProfit.dividedBy(t.revenue).times(100) : null,
  };
}
