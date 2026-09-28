import { prisma } from "@/lib/db";
import { PNL_TYPE_LABELS, PNL_TYPE_ORDER } from "@/lib/reports/pnl";
import type { BudgetKind } from "@prisma/client";
import type { BudgetArticle } from "./sheet";

export type BudgetArticleRow = BudgetArticle & { isArchived: boolean; groupOrder: number };

/** Статьи бюджета вида kind по порядку разделов (переводы между своими счетами в бюджет не входят). */
export async function loadBudgetArticles(kind: BudgetKind): Promise<BudgetArticleRow[]> {
  if (kind === "CASH_FLOW") {
    const articles = await prisma.cashFlowArticle.findMany({ where: { direction: { not: "TRANSFER" } }, orderBy: { name: "asc" } });
    return articles
      .map((a) => ({
        id: a.id,
        name: a.name,
        code: a.code,
        isArchived: a.isArchived,
        group: a.direction === "INFLOW" ? "Поступления" : "Выплаты",
        groupOrder: a.direction === "INFLOW" ? 0 : 1,
      }))
      .sort((a, b) => a.groupOrder - b.groupOrder);
  }
  const articles = await prisma.pnlArticle.findMany({ orderBy: { name: "asc" } });
  return articles
    .map((a) => ({
      id: a.id,
      name: a.name,
      code: a.code,
      isArchived: a.isArchived,
      group: PNL_TYPE_LABELS[a.type],
      groupOrder: PNL_TYPE_ORDER.indexOf(a.type),
    }))
    .sort((a, b) => a.groupOrder - b.groupOrder);
}
