"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { getAccessScope } from "@/lib/access-scope";
import { sumMoney, toDecimal } from "@/lib/money";
import { parseBudgetAmount } from "@/lib/budget/plan-fact";
import { loadBudgetArticles } from "@/lib/budget/articles";
import { parseBudgetSheet, parsePercent, scaleCells, type BudgetCell } from "@/lib/budget/sheet";
import { dimKey, parseDimKey, type BudgetSlice } from "@/lib/budget/slice";
import { parseSpreadsheet } from "@/lib/bank-import/parser";
import type { BudgetKind } from "@prisma/client";

const KIND_BY_SLUG = { "cash-flow": "CASH_FLOW", pnl: "PNL" } as const;
export type BudgetKindSlug = keyof typeof KIND_BY_SLUG;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function budgetUrl(kindSlug: BudgetKindSlug, year: number, slice: BudgetSlice, extra: string) {
  const params = new URLSearchParams({ kind: kindSlug, year: String(year), org: slice.organizationId ?? "", dim: dimKey(slice) });
  return `/budget?${params.toString()}&${extra}`;
}

/** Проверки, общие для всех действий с планом: право, доступ к организации, корректный разрез. */
async function openSlice(kindSlug: BudgetKindSlug, year: number, organizationId: string | null, dimRaw: string) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);
  const kind: BudgetKind = KIND_BY_SLUG[kindSlug];
  const dims = parseDimKey(dimRaw) ?? { departmentId: null, costCenterId: null, projectId: null };
  const slice: BudgetSlice = { organizationId, ...dims };
  const back = (extra: string): never => redirect(budgetUrl(kindSlug, year, slice, extra));
  if (!parseDimKey(dimRaw)) back(`error=${encodeURIComponent("Неизвестный разрез плана")}`);

  const scope = await getAccessScope(session);
  if (scope.organizationIds !== null && (!organizationId || !scope.organizationIds.includes(organizationId))) {
    back(`error=${encodeURIComponent("Нет доступа к плану этой организации")}`);
  }
  return { session, kind, slice, back };
}

function sliceWhere(kind: BudgetKind, year: number, slice: BudgetSlice) {
  return { kind, year, organizationId: slice.organizationId, departmentId: slice.departmentId, costCenterId: slice.costCenterId, projectId: slice.projectId };
}

function entryData(kind: BudgetKind, year: number, slice: BudgetSlice, cell: BudgetCell) {
  return {
    ...sliceWhere(kind, year, slice),
    month: cell.month,
    amount: cell.amount.toFixed(2),
    ...(kind === "CASH_FLOW" ? { cashFlowArticleId: cell.articleId } : { pnlArticleId: cell.articleId }),
  };
}

/**
 * Сохраняет сетку бюджета целиком: план на год по одному виду (ДДС или ОПиУ)
 * для одного среза — организации (или компании в целом) и, при желании,
 * одного разреза. Поля формы — `b__<articleId>__<month>`. Пустая ячейка —
 * «плана нет» (не 0). Год среза удаляется и записывается заново в одной
 * транзакции.
 */
export async function saveBudgetAction(kindSlug: BudgetKindSlug, year: number, organizationId: string | null, dimRaw: string, formData: FormData) {
  const { session, kind, slice, back } = await openSlice(kindSlug, year, organizationId, dimRaw);

  const articles = await loadBudgetArticles(kind);
  const articleNames = new Map(articles.map((a) => [a.id, a.name]));
  const cells: BudgetCell[] = [];
  const errors: string[] = [];
  for (const [key, raw] of formData.entries()) {
    const match = key.match(/^b__(.+)__(\d{1,2})$/);
    if (!match) continue;
    const [, articleId, monthStr] = match;
    const month = Number(monthStr);
    if (!articleNames.has(articleId) || month < 1 || month > 12) continue;
    const { value, error } = parseBudgetAmount(String(raw));
    if (error) errors.push(`${articleNames.get(articleId)}, месяц ${month}: ${error}`);
    else if (value) cells.push({ articleId, month, amount: value });
  }
  if (errors.length > 0) back(`error=${encodeURIComponent(errors.slice(0, 5).join("; "))}`);

  await prisma.$transaction([
    prisma.budgetEntry.deleteMany({ where: sliceWhere(kind, year, slice) }),
    prisma.budgetEntry.createMany({ data: cells.map((c) => entryData(kind, year, slice, c)) }),
  ]);
  await logAudit({
    userId: session.userId,
    entityType: "budget",
    entityId: `${kind}:${year}:${slice.organizationId ?? "company"}:${dimKey(slice) || "all"}`,
    action: "update",
    after: { kind, year, ...slice, cells: cells.length, total: sumMoney(cells.map((c) => c.amount)).toFixed(2) } as never,
  });

  revalidatePath("/budget");
  back("saved=1");
}

/**
 * Загрузка плана из Excel (та же сетка, что в выгрузке). Заменяется план
 * только тех статей, что есть в файле; остальные статьи среза не меняются.
 * Всё или ничего: при любой ошибке ничего не сохраняется.
 */
export async function importBudgetAction(kindSlug: BudgetKindSlug, year: number, organizationId: string | null, dimRaw: string, formData: FormData) {
  const { session, kind, slice, back } = await openSlice(kindSlug, year, organizationId, dimRaw);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return back(`error=${encodeURIComponent("Выберите файл")}`);
  if (file.size > MAX_FILE_BYTES) return back(`error=${encodeURIComponent("Файл слишком большой (максимум 4 МБ)")}`);
  let sheet: ReturnType<typeof parseSpreadsheet> | null = null;
  try {
    sheet = parseSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
  } catch {
    // reported below
  }
  if (!sheet) return back(`error=${encodeURIComponent("Не удалось прочитать файл. Поддерживаются XLSX, XLS, CSV")}`);

  const articles = await loadBudgetArticles(kind);
  const parsed = parseBudgetSheet(sheet.headers, sheet.rows, articles);
  if (parsed.errors.length > 0) {
    const shown = parsed.errors.slice(0, 8);
    if (parsed.errors.length > shown.length) shown.push(`…и ещё ${parsed.errors.length - shown.length}`);
    back(`error=${encodeURIComponent(shown.join("; "))}`);
  }

  const articleField = kind === "CASH_FLOW" ? "cashFlowArticleId" : "pnlArticleId";
  await prisma.$transaction([
    prisma.budgetEntry.deleteMany({ where: { ...sliceWhere(kind, year, slice), [articleField]: { in: parsed.articleIds } } }),
    prisma.budgetEntry.createMany({ data: parsed.cells.map((c) => entryData(kind, year, slice, c)) }),
  ]);
  await logAudit({
    userId: session.userId,
    entityType: "budget",
    entityId: `${kind}:${year}:${slice.organizationId ?? "company"}:${dimKey(slice) || "all"}`,
    action: "import",
    after: { kind, year, ...slice, fileName: file.name, articles: parsed.articleIds.length, cells: parsed.cells.length } as never,
  });

  revalidatePath("/budget");
  back(`notice=${encodeURIComponent(`Файл «${file.name}» загружен: статей — ${parsed.articleIds.length}, заполненных ячеек — ${parsed.cells.length}. План остальных статей не менялся.`)}`);
}

/**
 * Копирует план этого же среза с прошлого года, с поправкой в процентах.
 * Если на этот год план уже есть, нужно явно согласиться его заменить.
 */
export async function copyBudgetFromPreviousYearAction(kindSlug: BudgetKindSlug, year: number, organizationId: string | null, dimRaw: string, formData: FormData) {
  const { session, kind, slice, back } = await openSlice(kindSlug, year, organizationId, dimRaw);

  const percent = parsePercent(formData.get("percent"));
  if ("error" in percent) back(`error=${encodeURIComponent(percent.error)}`);
  const pct = (percent as { value: number }).value;

  const source = await prisma.budgetEntry.findMany({ where: sliceWhere(kind, year - 1, slice) });
  if (source.length === 0) back(`error=${encodeURIComponent(`На ${year - 1} год в этом срезе плана нет — копировать нечего`)}`);
  const existing = await prisma.budgetEntry.count({ where: sliceWhere(kind, year, slice) });
  if (existing > 0 && formData.get("overwrite") !== "on") {
    back(`error=${encodeURIComponent(`На ${year} год план уже есть (ячеек: ${existing}). Отметьте «Заменить текущий план», чтобы скопировать поверх`)}`);
  }

  const cells = scaleCells(
    source.map((e) => ({ articleId: (e.cashFlowArticleId ?? e.pnlArticleId)!, month: e.month, amount: toDecimal(e.amount) })),
    pct,
  );
  await prisma.$transaction([
    prisma.budgetEntry.deleteMany({ where: sliceWhere(kind, year, slice) }),
    prisma.budgetEntry.createMany({ data: cells.map((c) => entryData(kind, year, slice, c)) }),
  ]);
  await logAudit({
    userId: session.userId,
    entityType: "budget",
    entityId: `${kind}:${year}:${slice.organizationId ?? "company"}:${dimKey(slice) || "all"}`,
    action: "copy_previous_year",
    after: { kind, year, ...slice, fromYear: year - 1, percent: pct, cells: cells.length, replaced: existing } as never,
  });

  revalidatePath("/budget");
  back(`notice=${encodeURIComponent(`План скопирован с ${year - 1} года${pct ? ` с поправкой ${pct > 0 ? "+" : ""}${pct} %` : ""}, ячеек: ${cells.length}${existing ? `; прежний план (ячеек: ${existing}) заменён` : ""}.`)}`);
}
