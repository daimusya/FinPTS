import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import Decimal from "decimal.js";
import type { ReportFilters } from "./filters";
import type { ReportPeriod } from "./period";
import { derivePnlTotals, type PnlType } from "./pnl";
import { accrualScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";

/**
 * Точка безубыточности: выручка, при которой операционная прибыль равна нулю.
 * ТБУ = Постоянные затраты / Доля маржинального дохода
 * Доля маржинального дохода = 1 - (Переменные затраты / Выручка)
 * Возвращает null, если маржинальный доход не покрывает переменные затраты
 * (доля <= 0) — безубыточность недостижима при текущей структуре затрат.
 */
export function computeBreakEven(fixedCosts: Decimal, revenue: Decimal, variableCosts: Decimal): Decimal | null {
  if (revenue.lessThanOrEqualTo(0)) return null;
  const variableCostRatio = variableCosts.dividedBy(revenue);
  const contributionMarginRatio = new Decimal(1).minus(variableCostRatio);
  if (contributionMarginRatio.lessThanOrEqualTo(0)) return null;
  return fixedCosts.dividedBy(contributionMarginRatio);
}

/** Запас финансовой прочности: на сколько может упасть выручка до точки безубыточности. */
export function computeMarginOfSafety(revenue: Decimal, breakEven: Decimal | null): Decimal | null {
  if (breakEven === null || revenue.lessThanOrEqualTo(0)) return null;
  return revenue.minus(breakEven).dividedBy(revenue).times(100);
}

export interface DimensionMarginRow {
  key: string;
  label: string;
  revenue: Decimal;
  directCost: Decimal;
  grossProfit: Decimal;
  grossMarginPct: Decimal | null;
  allocatedIndirect: Decimal;
  operatingProfit: Decimal;
  operatingMarginPct: Decimal | null;
}

export type IndirectDriver = "revenue" | "grossProfit" | "equal";

export const INDIRECT_DRIVER_OPTIONS: IndirectDriver[] = ["revenue", "grossProfit", "equal"];

export const INDIRECT_DRIVER_LABELS: Record<IndirectDriver, string> = {
  revenue: "Пропорционально выручке",
  grossProfit: "Пропорционально валовой прибыли",
  equal: "Поровну между всеми",
};

/**
 * Распределяет общую сумму косвенных расходов периода между строками
 * измерения (проект/продукт/клиент). Косвенные расходы в документах
 * обычно не привязаны к конкретному проекту/продукту/клиенту, поэтому
 * распределяются только по выбранному драйверу, а не по факту.
 * «revenue»/«grossProfit» — вес строки равен её выручке/валовой прибыли
 * (отрицательные и нулевые веса не участвуют, только тянут долю вниз);
 * если у всех строк вес получился нулевым (например, драйвер —
 * grossProfit, а все строки в убытке) — распределяем поровну, чтобы
 * расходы не потерялись молча. «equal» — поровну всегда.
 */
export function allocateIndirectCosts(
  rows: Array<{ key: string; revenue: Decimal; grossProfit: Decimal }>,
  totalIndirect: Decimal,
  driver: IndirectDriver,
): Map<string, Decimal> {
  const result = new Map<string, Decimal>();
  if (rows.length === 0) return result;
  if (totalIndirect.equals(0)) {
    for (const row of rows) result.set(row.key, toDecimal(0));
    return result;
  }

  function weightFor(row: { revenue: Decimal; grossProfit: Decimal }): Decimal {
    if (driver === "equal") return new Decimal(1);
    const base = driver === "revenue" ? row.revenue : row.grossProfit;
    return base.greaterThan(0) ? base : toDecimal(0);
  }

  let weights = rows.map(weightFor);
  let totalWeight = sumMoney(weights);
  if (totalWeight.equals(0)) {
    weights = rows.map(() => new Decimal(1));
    totalWeight = new Decimal(rows.length);
  }

  rows.forEach((row, i) => {
    result.set(row.key, totalIndirect.times(weights[i]).dividedBy(totalWeight));
  });
  return result;
}

type Dimension = "project" | "productService" | "counterparty";

async function aggregateByDimension(
  period: ReportPeriod,
  filters: ReportFilters,
  dimension: Dimension,
  scope: AccessScope,
  totalIndirect: Decimal,
  driver: IndirectDriver,
): Promise<DimensionMarginRow[]> {
  const documents = await prisma.accrualDocument.findMany({
    where: {
      AND: [
        { status: "POSTED", date: { gte: period.from, lte: period.to } },
        ...(filters.organizationId ? [{ organizationId: filters.organizationId }] : []),
        ...(filters.counterpartyId ? [{ counterpartyId: filters.counterpartyId }] : []),
        accrualScopeWhere(scope),
      ],
    },
    include: {
      counterparty: true,
      lines: { include: { pnlArticle: true, project: true, productService: true } },
    },
  });

  const map = new Map<string, DimensionMarginRow>();

  for (const doc of documents) {
    for (const line of doc.lines) {
      if (!line.pnlArticle) continue;
      const type = line.pnlArticle.type as PnlType;
      if (type !== "REVENUE" && type !== "DIRECT_VARIABLE" && type !== "DIRECT_FIXED") continue;

      let key: string;
      let label: string;
      if (dimension === "project") {
        if (!line.project) continue;
        key = line.project.id;
        label = line.project.name;
      } else if (dimension === "productService") {
        if (!line.productService) continue;
        key = line.productService.id;
        label = line.productService.name;
      } else {
        key = doc.counterpartyId;
        label = doc.counterparty.shortName || doc.counterparty.fullName;
      }

      const row =
        map.get(key) ??
        ({
          key,
          label,
          revenue: toDecimal(0),
          directCost: toDecimal(0),
          grossProfit: toDecimal(0),
          grossMarginPct: null,
          allocatedIndirect: toDecimal(0),
          operatingProfit: toDecimal(0),
          operatingMarginPct: null,
        } as DimensionMarginRow);
      const amount = toDecimal(line.amount);
      if (type === "REVENUE") row.revenue = row.revenue.plus(amount);
      else row.directCost = row.directCost.plus(amount);
      map.set(key, row);
    }
  }

  const rows = Array.from(map.values());
  for (const row of rows) {
    row.grossProfit = row.revenue.minus(row.directCost);
    row.grossMarginPct = row.revenue.greaterThan(0) ? row.grossProfit.dividedBy(row.revenue).times(100) : null;
  }

  const allocation = allocateIndirectCosts(rows, totalIndirect, driver);
  for (const row of rows) {
    row.allocatedIndirect = allocation.get(row.key) ?? toDecimal(0);
    row.operatingProfit = row.grossProfit.minus(row.allocatedIndirect);
    row.operatingMarginPct = row.revenue.greaterThan(0) ? row.operatingProfit.dividedBy(row.revenue).times(100) : null;
  }

  return rows.sort((a, b) => b.revenue.comparedTo(a.revenue));
}

export interface MarginReport {
  revenue: Decimal;
  directVariable: Decimal;
  directFixed: Decimal;
  grossProfit: Decimal;
  indirect: Decimal;
  operatingProfit: Decimal;
  grossMarginPct: Decimal | null;
  operatingMarginPct: Decimal | null;
  breakEvenRevenue: Decimal | null;
  marginOfSafetyPct: Decimal | null;
  byProject: DimensionMarginRow[];
  byProductService: DimensionMarginRow[];
  byCounterparty: DimensionMarginRow[];
}

export async function computeMarginReport(
  period: ReportPeriod,
  filters: ReportFilters,
  scope: AccessScope = UNRESTRICTED_SCOPE,
  driver: IndirectDriver = "revenue",
): Promise<MarginReport> {
  const documents = await prisma.accrualDocument.findMany({
    where: {
      AND: [
        { status: "POSTED", date: { gte: period.from, lte: period.to } },
        ...(filters.organizationId ? [{ organizationId: filters.organizationId }] : []),
        ...(filters.counterpartyId ? [{ counterpartyId: filters.counterpartyId }] : []),
        accrualScopeWhere(scope),
      ],
    },
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

  const byType: Record<PnlType, Decimal> = {
    REVENUE: toDecimal(0),
    DIRECT_VARIABLE: toDecimal(0),
    DIRECT_FIXED: toDecimal(0),
    INDIRECT: toDecimal(0),
    OTHER_INCOME: toDecimal(0),
    OTHER_EXPENSE: toDecimal(0),
    TAX: toDecimal(0),
  };
  for (const doc of documents) {
    for (const line of doc.lines) {
      if (!line.pnlArticle) continue;
      const type = line.pnlArticle.type as PnlType;
      byType[type] = byType[type].plus(toDecimal(line.amount));
    }
  }

  const totals = derivePnlTotals({
    revenue: byType.REVENUE,
    directVariable: byType.DIRECT_VARIABLE,
    directFixed: byType.DIRECT_FIXED,
    indirect: byType.INDIRECT,
    otherIncome: toDecimal(0),
    otherExpense: toDecimal(0),
    tax: toDecimal(0),
  });

  const fixedCosts = totals.directFixed.plus(totals.indirect);
  const breakEvenRevenue = computeBreakEven(fixedCosts, totals.revenue, totals.directVariable);
  const marginOfSafetyPct = computeMarginOfSafety(totals.revenue, breakEvenRevenue);

  const [byProject, byProductService, byCounterparty] = await Promise.all([
    aggregateByDimension(period, filters, "project", scope, totals.indirect, driver),
    aggregateByDimension(period, filters, "productService", scope, totals.indirect, driver),
    aggregateByDimension(period, filters, "counterparty", scope, totals.indirect, driver),
  ]);

  return {
    revenue: totals.revenue,
    directVariable: totals.directVariable,
    directFixed: totals.directFixed,
    grossProfit: totals.grossProfit,
    indirect: totals.indirect,
    operatingProfit: totals.operatingProfit,
    grossMarginPct: totals.grossMarginPct,
    operatingMarginPct: totals.revenue.greaterThan(0) ? totals.operatingProfit.dividedBy(totals.revenue).times(100) : null,
    breakEvenRevenue,
    marginOfSafetyPct,
    byProject,
    byProductService,
    byCounterparty,
  };
}
