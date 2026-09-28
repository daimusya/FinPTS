export type PeriodSpan = "month" | "quarter" | "year";

export interface ReportPeriod {
  from: Date;
  to: Date;
  label: string;
  year: number;
  /** Первый месяц периода (для квартала и года — первый месяц квартала / январь). */
  month: number;
  /** Длина периода; по умолчанию — месяц. */
  span?: PeriodSpan;
}

/** Первый и последний (включительно, конец дня) день месяца в UTC. */
export function monthRange(year: number, month: number): { from: Date; to: Date } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
}

const MONTH_NAMES = [
  "январь", "февраль", "март", "апрель", "май", "июнь",
  "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь",
];

const SPAN_MONTHS: Record<PeriodSpan, number> = { month: 1, quarter: 3, year: 12 };

export const quarterOf = (month: number) => Math.floor((month - 1) / 3) + 1;

/** Период отчёта длиной span, начинающийся с месяца start (для квартала и года — выровненного по началу). */
export function buildPeriod(year: number, start: number, span: PeriodSpan = "month"): ReportPeriod {
  const first = span === "year" ? 1 : span === "quarter" ? (quarterOf(start) - 1) * 3 + 1 : start;
  const last = first + SPAN_MONTHS[span] - 1;
  const from = new Date(Date.UTC(year, first - 1, 1));
  const to = new Date(Date.UTC(year, last, 0, 23, 59, 59, 999));
  const label =
    span === "year" ? `${year} год` : span === "quarter" ? `${quarterOf(first)} квартал ${year}` : `${MONTH_NAMES[first - 1]} ${year}`;
  return { from, to, year, month: first, span, label };
}

/** Месяцы периода по порядку — для сложения помесячного плана. */
export function periodMonths(period: ReportPeriod): Array<{ year: number; month: number }> {
  return Array.from({ length: SPAN_MONTHS[period.span ?? "month"] }, (_, i) => ({ year: period.year, month: period.month + i }));
}

export function resolveReportPeriod(searchParams: { year?: string; month?: string; span?: string; quarter?: string }): ReportPeriod {
  const now = new Date();
  const year = Number(searchParams.year) || now.getUTCFullYear();
  const span: PeriodSpan = searchParams.span === "quarter" || searchParams.span === "year" ? searchParams.span : "month";
  const month = Number(searchParams.month) || now.getUTCMonth() + 1;
  const quarter = Number(searchParams.quarter);
  const start = span === "quarter" && quarter >= 1 && quarter <= 4 ? (quarter - 1) * 3 + 1 : Math.min(Math.max(month, 1), 12);
  return buildPeriod(year, start, span);
}

/** Предыдущий период той же длины: месяц, квартал или год. */
export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const span = period.span ?? "month";
  if (span === "year") return buildPeriod(period.year - 1, 1, "year");
  const step = SPAN_MONTHS[span];
  const index = period.year * 12 + (period.month - 1) - step;
  return buildPeriod(Math.floor(index / 12), (index % 12) + 1, span);
}

/** Параметры адреса для периода — чтобы ссылки и выгрузки открывали тот же период. */
export function periodQuery(period: ReportPeriod): string {
  const span = period.span ?? "month";
  if (span === "year") return `year=${period.year}&span=year`;
  if (span === "quarter") return `year=${period.year}&span=quarter&quarter=${quarterOf(period.month)}`;
  return `year=${period.year}&month=${period.month}`;
}
