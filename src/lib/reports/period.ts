export interface ReportPeriod {
  from: Date;
  to: Date;
  label: string;
  year: number;
  month: number;
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

export function resolveReportPeriod(searchParams: { year?: string; month?: string }): ReportPeriod {
  const now = new Date();
  const year = Number(searchParams.year) || now.getUTCFullYear();
  const month = Number(searchParams.month) || now.getUTCMonth() + 1;
  const { from, to } = monthRange(year, month);
  return { from, to, year, month, label: `${MONTH_NAMES[month - 1]} ${year}` };
}

export function previousPeriod(period: ReportPeriod): ReportPeriod {
  const month = period.month === 1 ? 12 : period.month - 1;
  const year = period.month === 1 ? period.year - 1 : period.year;
  const { from, to } = monthRange(year, month);
  return { from, to, year, month, label: `${MONTH_NAMES[month - 1]} ${year}` };
}
