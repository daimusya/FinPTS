import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getAccessScope } from "@/lib/access-scope";
import { toDecimal } from "@/lib/money";
import { loadBudgetArticles } from "@/lib/budget/articles";
import { buildBudgetSheet } from "@/lib/budget/sheet";
import { parseDimKey } from "@/lib/budget/slice";
import { buildWorkbookBuffer } from "@/lib/reports/xlsx-export";

/** Выгрузка плана на год (один срез) в Excel — она же шаблон для загрузки. */
export async function GET(request: NextRequest) {
  let session;
  try {
    session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_VIEW);
  } catch {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") === "cash-flow" ? "CASH_FLOW" : "PNL";
  const year = Number(sp.get("year")) || new Date().getFullYear();
  const organizationId = sp.get("org") || null;
  const dims = parseDimKey(sp.get("dim") ?? "");
  if (!dims) return new Response("Неизвестный разрез", { status: 400 });

  const scope = await getAccessScope(session);
  if (scope.organizationIds !== null && (!organizationId || !scope.organizationIds.includes(organizationId))) {
    return new Response("Нет доступа к плану этой организации", { status: 403 });
  }

  const [articles, entries] = await Promise.all([
    loadBudgetArticles(kind),
    prisma.budgetEntry.findMany({ where: { kind, year, organizationId, ...dims } }),
  ]);
  const planned = new Set(entries.map((e) => e.cashFlowArticleId ?? e.pnlArticleId));
  const rows = buildBudgetSheet(
    articles.filter((a) => !a.isArchived || planned.has(a.id)),
    entries.map((e) => ({ articleId: (e.cashFlowArticleId ?? e.pnlArticleId)!, month: e.month, amount: toDecimal(e.amount) })),
  );
  const buffer = buildWorkbookBuffer([{ name: `${kind === "CASH_FLOW" ? "БДДС" : "БДР"} ${year}`, rows }]);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="budget_${kind === "CASH_FLOW" ? "dds" : "pnl"}_${year}.xlsx"`,
    },
  });
}
