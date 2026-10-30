import { parseDateParam } from "@/lib/date-param";

/**
 * Период просмотра поступлений посредников: любые даты «с/по» включительно.
 * Не задана дата «с» — с самого начала, «по» — по сегодня. Без параметров —
 * с начала года. Чистые функции — проверяются тестами.
 */
export interface Period {
  /** Первый день периода; null — с самой ранней операции. */
  from: Date | null;
  /** Последний день периода (включительно). */
  to: Date;
}

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const dateParam = (d: Date) => d.toISOString().slice(0, 10);
const ru = (d: Date) => dateParam(d).split("-").reverse().join(".");

export function parsePeriod(params: { from?: string; to?: string; all?: string }, now = new Date()): Period {
  const today = utcDay(now);
  let from = parseDateParam(params.from);
  let to = parseDateParam(params.to) ?? today;
  if (!from && !params.to && params.all !== "1") from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
  if (from && from > to) [from, to] = [to, from];
  return { from, to };
}

/** Граница выборки: операции до начала следующего за «по» дня. */
export const periodEndExclusive = (p: Period) => new Date(p.to.getTime() + 24 * 3600_000);

export function periodLabel(p: Period): string {
  return p.from ? `${ru(p.from)} — ${ru(p.to)}` : `за всё время по ${ru(p.to)}`;
}

/** Параметры адреса для периода: ссылка открывает тот же период. */
export function periodQuery(p: Period): Record<string, string> {
  return p.from ? { from: dateParam(p.from), to: dateParam(p.to) } : { all: "1", to: dateParam(p.to) };
}

export interface PeriodPreset {
  label: string;
  period: Period;
}

/** Быстрый выбор: месяц, прошлый месяц, квартал, с начала года, прошлый год, всё время. */
export function periodPresets(now = new Date()): PeriodPreset[] {
  const today = utcDay(now);
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const day = (year: number, month: number, d: number) => new Date(Date.UTC(year, month, d));
  const quarter = Math.floor(m / 3) * 3;
  return [
    { label: "Этот месяц", period: { from: day(y, m, 1), to: today } },
    { label: "Прошлый месяц", period: { from: day(y, m - 1, 1), to: day(y, m, 0) } },
    { label: "Квартал", period: { from: day(y, quarter, 1), to: today } },
    { label: "С начала года", period: { from: day(y, 0, 1), to: today } },
    { label: "Прошлый год", period: { from: day(y - 1, 0, 1), to: day(y - 1, 11, 31) } },
    { label: "Всё время", period: { from: null, to: today } },
  ];
}

export const samePeriod = (a: Period, b: Period) => (a.from?.getTime() ?? null) === (b.from?.getTime() ?? null) && a.to.getTime() === b.to.getTime();
