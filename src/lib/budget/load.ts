import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import type { BudgetKind } from "@prisma/client";
import type { PlanItem } from "./plan-fact";

/**
 * План за месяц по статьям, просуммированный по организациям.
 * organizationIds = null — все записи плана (включая план по компании в
 * целом), массив — только план этих организаций.
 */
export async function loadPlanItems(
  kind: BudgetKind,
  year: number,
  month: number,
  organizationIds: string[] | null,
): Promise<PlanItem[]> {
  const entries = await prisma.budgetEntry.findMany({
    where: { kind, year, month, ...(organizationIds ? { organizationId: { in: organizationIds } } : {}) },
    include: { cashFlowArticle: true, pnlArticle: true },
  });

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
