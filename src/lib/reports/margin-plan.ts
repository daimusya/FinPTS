import Decimal from "decimal.js";
import type { DimensionMarginRow } from "./margin";

export interface ProjectPlanRow extends DimensionMarginRow {
  /** План проекта из бюджета (разрез «проект»); null — плана нет. */
  plan: { revenue: Decimal; directCost: Decimal; grossProfit: Decimal } | null;
}

/**
 * Факт маржинальности по проектам вместе с планом бюджета: к строке проекта —
 * его плановые выручка, прямые расходы и валовая прибыль; проекты с планом,
 * но без факта за период, добавляются строками с нулевым фактом. При фильтре
 * по проекту — только он.
 */
export function mergeProjectPlan(
  rows: DimensionMarginRow[],
  plan: Map<string, { name: string; revenue: Decimal; directCost: Decimal }> | null,
  onlyProjectId: string | null,
): ProjectPlanRow[] {
  const planned = (id: string) => {
    const p = plan?.get(id);
    return p ? { revenue: p.revenue, directCost: p.directCost, grossProfit: p.revenue.minus(p.directCost) } : null;
  };
  const result: ProjectPlanRow[] = rows.map((row) => ({ ...row, plan: planned(row.key) }));
  for (const [id, p] of plan ?? []) {
    if (result.some((r) => r.key === id) || (onlyProjectId && id !== onlyProjectId)) continue;
    const zero = new Decimal(0);
    result.push({
      key: id,
      label: p.name,
      revenue: zero,
      directCost: zero,
      grossProfit: zero,
      grossMarginPct: null,
      allocatedIndirect: zero,
      operatingProfit: zero,
      operatingMarginPct: null,
      plan: planned(id),
    });
  }
  return result;
}
