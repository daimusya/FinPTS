import Decimal from "decimal.js";
import { sumMoney, toDecimal } from "@/lib/money";
import type { AccessScope } from "@/lib/access-scope";
import type { ReportFilters } from "@/lib/reports/filters";

/** Плановая сумма по одной статье за период (уже просуммированная по организациям). */
export interface PlanItem {
  articleId: string;
  articleName: string;
  /** Раздел отчёта: направление статьи ДДС (INFLOW/OUTFLOW) или тип статьи ОПиУ. */
  group: string;
  amount: Decimal;
}

export type PlanAvailability =
  | { available: true; /** null — все записи плана, включая план по компании в целом. */ organizationIds: string[] | null }
  | { available: false; reason: string };

/**
 * Можно ли честно сравнить факт отчёта с планом. План задаётся по статьям —
 * по компании в целом или по организации, — поэтому при фильтре по
 * подразделению, ЦФО, проекту, продукту или контрагенту (и при доступе,
 * ограниченном подразделениями или проектами) факт — лишь часть статьи, и
 * сравнение с планом всей статьи вводило бы в заблуждение.
 */
export function resolvePlanAvailability(filters: ReportFilters, scope: AccessScope): PlanAvailability {
  if (filters.departmentId || filters.costCenterId || filters.projectId || filters.productServiceId || filters.counterpartyId) {
    return {
      available: false,
      reason:
        "План задаётся по статьям для компании в целом или для организации, поэтому при фильтре по подразделению, ЦФО, проекту, продукту или контрагенту сравнение с планом не показывается.",
    };
  }
  if (scope.departmentIds !== null || scope.projectIds !== null) {
    return {
      available: false,
      reason:
        "Ваш доступ ограничен подразделениями или проектами — факт в отчёте неполный, поэтому сравнение с планом не показывается.",
    };
  }
  if (filters.organizationId) return { available: true, organizationIds: [filters.organizationId] };
  // Restricted to some organizations: the company-wide plan can't be split between them, so only their own plans count.
  return { available: true, organizationIds: scope.organizationIds };
}

export interface PlanFactMetrics {
  plan: Decimal | null;
  /** Факт − план; null, если плана нет. */
  deviation: Decimal | null;
  /** Факт / план × 100; null, если плана нет или он нулевой. */
  executionPct: Decimal | null;
}

export function planFactMetrics(fact: Decimal, plan: Decimal | null | undefined): PlanFactMetrics {
  if (plan === null || plan === undefined) return { plan: null, deviation: null, executionPct: null };
  return {
    plan,
    deviation: fact.minus(plan),
    executionPct: plan.isZero() ? null : fact.dividedBy(plan).times(100),
  };
}

/**
 * Хорошо ли отклонение для компании: перевыполнение плана по доходам и
 * прибыли — хорошо, по расходам и выплатам — плохо. null — отклонения нет.
 */
export function isFavorable(deviation: Decimal | null, nature: "income" | "expense"): boolean | null {
  if (!deviation || deviation.isZero()) return null;
  return nature === "income" ? deviation.greaterThan(0) : deviation.lessThan(0);
}

interface FactRowLike {
  articleId: string | null;
  articleName: string;
  amount: Decimal;
}

/**
 * Добавляет к строкам факта план. Статьи, по которым есть план, но нет
 * факта, появляются отдельными строками с нулевым фактом — иначе
 * невыполненный план (например, не поступившая выручка) просто не был бы
 * виден в отчёте.
 */
export function mergePlanIntoRows<T extends FactRowLike>(
  factRows: T[],
  planItems: PlanItem[],
  makeEmptyRow: (item: PlanItem) => T,
): Array<T & PlanFactMetrics> {
  const planByArticle = new Map(planItems.map((p) => [p.articleId, p]));
  const seen = new Set<string>();
  const rows = factRows.map((row) => {
    if (row.articleId) seen.add(row.articleId);
    const plan = row.articleId ? planByArticle.get(row.articleId)?.amount : undefined;
    return { ...row, ...planFactMetrics(row.amount, plan) };
  });
  for (const item of planItems) {
    if (seen.has(item.articleId)) continue;
    const empty = makeEmptyRow(item);
    rows.push({ ...empty, ...planFactMetrics(toDecimal(0), item.amount) });
  }
  return rows;
}

/** Сумма плана по разделу; null, если в разделе нет ни одной строки плана. */
export function planTotal(planItems: PlanItem[], group: string): Decimal | null {
  const items = planItems.filter((p) => p.group === group);
  return items.length === 0 ? null : sumMoney(items.map((p) => p.amount));
}

/** Разбор суммы из ячейки сетки бюджета: «1 500,50» → 1500.50; пусто → null. */
export function parseBudgetAmount(raw: string): { value: Decimal | null; error?: string } {
  const cleaned = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "") return { value: null };
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return { value: null, error: `«${raw}» — не сумма` };
  const value = new Decimal(cleaned);
  if (value.isNegative()) return { value: null, error: `«${raw}» — сумма плана не может быть отрицательной` };
  return { value };
}
