import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import type { BudgetKind } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { PlanItem, PlanSlice } from "./plan-fact";
import type Decimal from "decimal.js";

/**
 * План ОПиУ по проектам за период: выручка и прямые расходы каждого проекта
 * (записи плана с разрезом «проект»), по компании в целом и по организациям
 * среза — для сравнения в маржинальности по проектам.
 */
export async function loadPlanByProject(
  months: Array<{ year: number; month: number }>,
  organizationIds: string[] | null,
): Promise<Map<string, { name: string; revenue: Decimal; directCost: Decimal }>> {
  const where: Prisma.BudgetEntryWhereInput = {
    kind: "PNL",
    projectId: { not: null },
    OR: months.map((m) => ({ year: m.year, month: m.month })),
  };
  if (organizationIds) where.AND = [{ OR: [{ organizationId: { in: organizationIds } }, { organizationId: null }] }];
  const entries = await prisma.budgetEntry.findMany({ where, include: { pnlArticle: true, project: true } });
  const byProject = new Map<string, { name: string; revenue: Decimal; directCost: Decimal }>();
  for (const e of entries) {
    if (!e.project || !e.pnlArticle) continue;
    const type = e.pnlArticle.type;
    if (type !== "REVENUE" && type !== "DIRECT_VARIABLE" && type !== "DIRECT_FIXED") continue;
    const item = byProject.get(e.project.id) ?? { name: e.project.name, revenue: toDecimal(0), directCost: toDecimal(0) };
    if (type === "REVENUE") item.revenue = item.revenue.plus(toDecimal(e.amount));
    else item.directCost = item.directCost.plus(toDecimal(e.amount));
    byProject.set(e.project.id, item);
  }
  return byProject;
}

/**
 * План за период (один или несколько месяцев) по статьям, просуммированный
 * по организациям и разрезам. Без разреза в срезе — все записи плана (план
 * компании, организаций, подразделений, ЦФО и проектов складываются);
 * с разрезом — только план этого подразделения / ЦФО / проекта (заданный
 * по компании в целом или по организациям среза).
 */
export async function loadPlanItems(
  kind: BudgetKind,
  months: Array<{ year: number; month: number }>,
  slice: PlanSlice,
): Promise<PlanItem[]> {
  const where: Prisma.BudgetEntryWhereInput = {
    kind,
    OR: months.map((m) => ({ year: m.year, month: m.month })),
  };
  if (slice.dimension) {
    where[slice.dimension.field] = slice.dimension.id;
    if (slice.organizationIds) where.AND = [{ OR: [{ organizationId: { in: slice.organizationIds } }, { organizationId: null }] }];
  } else if (slice.organizationIds) {
    where.organizationId = { in: slice.organizationIds };
  }
  const entries = await prisma.budgetEntry.findMany({ where, include: { cashFlowArticle: true, pnlArticle: true } });

  const byArticle = new Map<string, PlanItem>();
  for (const entry of entries) {
    const article = kind === "CASH_FLOW" ? entry.cashFlowArticle : entry.pnlArticle;
    if (!article) continue;
    const group = "direction" in article ? article.direction : article.type;
    const item = byArticle.get(article.id) ?? { articleId: article.id, articleName: article.name, group, amount: toDecimal(0) };
    item.amount = item.amount.plus(toDecimal(entry.amount));
    byArticle.set(article.id, item);
  }
  return Array.from(byArticle.values());
}
