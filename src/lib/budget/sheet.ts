import Decimal from "decimal.js";
import { parseBudgetAmount } from "./plan-fact";

/** Сетка плана на год в Excel: «статья × 12 месяцев», как в редакторе бюджета. */
export const BUDGET_MONTH_HEADERS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const MONTH_STEMS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

export interface BudgetArticle {
  id: string;
  name: string;
  code: string | null;
  /** Раздел: «Поступления», «Выручка» и т. п. — для удобства в файле, при загрузке не нужен. */
  group: string;
}

export interface BudgetCell {
  articleId: string;
  month: number;
  amount: Decimal;
}

export function buildBudgetSheet(articles: BudgetArticle[], cells: BudgetCell[]): Array<Array<string | number>> {
  const byKey = new Map(cells.map((c) => [`${c.articleId}-${c.month}`, c.amount]));
  const header = ["Статья", "Код", "Раздел", ...BUDGET_MONTH_HEADERS, "Итого за год"];
  const rows = articles.map((a) => {
    const months = Array.from({ length: 12 }, (_, i) => byKey.get(`${a.id}-${i + 1}`));
    const total = months.reduce<Decimal>((sum, v) => sum.plus(v ?? 0), new Decimal(0));
    return [a.name, a.code ?? "", a.group, ...months.map((v) => (v ? v.toNumber() : "")), months.some(Boolean) ? total.toNumber() : ""];
  });
  return [header, ...rows];
}

/** Номер месяца по заголовку колонки: «Янв», «январь», «Янв.», «1», «01». */
export function monthFromHeader(raw: string): number | null {
  const h = raw.trim().toLowerCase().replace(/\.$/, "");
  if (/^\d{1,2}$/.test(h)) {
    const n = Number(h);
    return n >= 1 && n <= 12 ? n : null;
  }
  const i = MONTH_STEMS.findIndex((stem) => h.startsWith(stem) || (stem === "май" && h === "мая"));
  return i >= 0 ? i + 1 : null;
}

type Cell = string | number | null;

/**
 * Разбор загруженной сетки плана. Статья ищется по колонке «Код», если она
 * заполнена, иначе по названию; неизвестная статья, статья дважды и неверная
 * сумма — ошибки с номером строки. Колонки месяцев узнаются по названию или
 * номеру; «Итого» и прочие колонки игнорируются. Пустая ячейка — «плана нет».
 */
export function parseBudgetSheet(
  headers: string[],
  rows: Cell[][],
  articles: BudgetArticle[],
): { cells: BudgetCell[]; articleIds: string[]; errors: string[] } {
  const errors: string[] = [];
  const lower = headers.map((h) => String(h ?? "").trim().toLowerCase());
  const nameCol = lower.findIndex((h) => h === "статья" || h === "статья *");
  const codeCol = lower.indexOf("код");
  const monthCols = new Map<number, number>();
  lower.forEach((h, i) => {
    if (i === nameCol || i === codeCol) return;
    const month = monthFromHeader(h);
    if (month && !monthCols.has(month)) monthCols.set(month, i);
  });
  if (nameCol < 0 && codeCol < 0) errors.push("В файле нет колонки «Статья» или «Код»");
  if (monthCols.size === 0) errors.push("В файле нет колонок месяцев (Янв … Дек)");
  if (errors.length > 0) return { cells: [], articleIds: [], errors };

  const byCode = new Map<string, BudgetArticle>();
  for (const a of articles) if (a.code) byCode.set(a.code.trim().toLowerCase(), a);
  const cells: BudgetCell[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 2;
    const name = nameCol >= 0 ? String(row[nameCol] ?? "").trim() : "";
    const code = codeCol >= 0 ? String(row[codeCol] ?? "").trim() : "";
    const monthValues = [...monthCols.entries()].map(([month, col]) => [month, String(row[col] ?? "").trim()] as const);
    if (!name && !code && monthValues.every(([, v]) => v === "")) return;

    let article: BudgetArticle | undefined;
    if (code) {
      article = byCode.get(code.toLowerCase());
      if (!article) return void errors.push(`Строка ${line}: статьи с кодом «${code}» нет`);
    } else {
      const matches = articles.filter((a) => a.name.trim().toLowerCase() === name.toLowerCase());
      if (matches.length > 1) return void errors.push(`Строка ${line}: статей «${name}» несколько — укажите код статьи`);
      article = matches[0];
      if (!article) return void errors.push(`Строка ${line}: статьи «${name}» нет${name ? "" : " (пустое название)"}`);
    }
    if (seen.has(article.id)) return void errors.push(`Строка ${line}: статья «${article.name}» уже есть в строке ${seen.get(article.id)}`);
    seen.set(article.id, line);

    for (const [month, raw] of monthValues) {
      const { value, error } = parseBudgetAmount(raw);
      if (error) errors.push(`Строка ${line}, ${BUDGET_MONTH_HEADERS[month - 1]}: ${error}`);
      else if (value) cells.push({ articleId: article.id, month, amount: value });
    }
  });

  if (errors.length === 0 && seen.size === 0) errors.push("В файле нет строк со статьями");
  return errors.length > 0 ? { cells: [], articleIds: [], errors } : { cells, articleIds: [...seen.keys()], errors };
}

/** План с прошлого года с поправкой в процентах (+10 → на 10 % больше), до копеек. */
export function scaleCells<T extends { amount: Decimal }>(cells: T[], percent: number): T[] {
  const factor = new Decimal(100).plus(percent).dividedBy(100);
  return cells.map((c) => ({ ...c, amount: c.amount.times(factor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) }));
}

/** Поправка в процентах из формы: «10», «-5», «2,5»; от −100 до +1000. */
export function parsePercent(raw: unknown): { value: number } | { error: string } {
  const s = String(raw ?? "").trim().replace(",", ".").replace(/%$/, "");
  if (s === "") return { value: 0 };
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return { error: `«${String(raw)}» — не число процентов` };
  const value = Number(s);
  if (value < -100 || value > 1000) return { error: "Поправка — от −100 % до +1000 %" };
  return { value };
}
