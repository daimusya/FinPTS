"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { getAccessScope } from "@/lib/access-scope";
import { sumMoney } from "@/lib/money";
import { parseBudgetAmount } from "@/lib/budget/plan-fact";
import type Decimal from "decimal.js";

const KIND_BY_SLUG = { "cash-flow": "CASH_FLOW", pnl: "PNL" } as const;
export type BudgetKindSlug = keyof typeof KIND_BY_SLUG;

function budgetUrl(kindSlug: BudgetKindSlug, year: number, organizationId: string | null, extra: string) {
  const params = new URLSearchParams({ kind: kindSlug, year: String(year), org: organizationId ?? "" });
  return `/budget?${params.toString()}&${extra}`;
}

/**
 * Сохраняет сетку бюджета целиком: план на год по одному виду (ДДС или
 * ОПиУ) для одной организации или для компании в целом. Поля формы —
 * `b__<articleId>__<month>`. Пустая ячейка — «плана нет» (не 0). Год
 * сначала удаляется и записывается заново в одной транзакции — так
 * соблюдается уникальность «статья × месяц × организация».
 */
export async function saveBudgetAction(kindSlug: BudgetKindSlug, year: number, organizationId: string | null, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);
  const kind = KIND_BY_SLUG[kindSlug];
  const back = (extra: string) => budgetUrl(kindSlug, year, organizationId, extra);

  const scope = await getAccessScope(session);
  if (scope.organizationIds !== null && (!organizationId || !scope.organizationIds.includes(organizationId))) {
    redirect(back(`error=${encodeURIComponent("Нет доступа к плану этой организации")}`));
  }

  const articles =
    kind === "CASH_FLOW"
      ? await prisma.cashFlowArticle.findMany({ where: { direction: { not: "TRANSFER" } }, select: { id: true, name: true } })
      : await prisma.pnlArticle.findMany({ select: { id: true, name: true } });
  const articleNames = new Map(articles.map((a) => [a.id, a.name]));

  const entries: Array<{ articleId: string; month: number; amount: Decimal }> = [];
  const errors: string[] = [];
  for (const [key, raw] of formData.entries()) {
    const match = key.match(/^b__(.+)__(\d{1,2})$/);
    if (!match) continue;
    const [, articleId, monthStr] = match;
    const month = Number(monthStr);
    if (!articleNames.has(articleId) || month < 1 || month > 12) continue;
    const { value, error } = parseBudgetAmount(String(raw));
    if (error) errors.push(`${articleNames.get(articleId)}, месяц ${month}: ${error}`);
    else if (value) entries.push({ articleId, month, amount: value });
  }
  if (errors.length > 0) {
    redirect(back(`error=${encodeURIComponent(errors.slice(0, 5).join("; "))}`));
  }

  await prisma.$transaction([
    prisma.budgetEntry.deleteMany({ where: { kind, year, organizationId } }),
    prisma.budgetEntry.createMany({
      data: entries.map((e) => ({
        kind,
        year,
        month: e.month,
        organizationId,
        amount: e.amount.toFixed(2),
        ...(kind === "CASH_FLOW" ? { cashFlowArticleId: e.articleId } : { pnlArticleId: e.articleId }),
      })),
    }),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "budget",
    entityId: `${kind}:${year}:${organizationId ?? "company"}`,
    action: "update",
    after: { kind, year, organizationId, cells: entries.length, total: sumMoney(entries.map((e) => e.amount)).toFixed(2) } as never,
  });

  revalidatePath("/budget");
  redirect(back("saved=1"));
}
