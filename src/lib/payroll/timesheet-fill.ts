import { TIME_SHEET_DAY_TYPE_LABELS } from "./labels";

/**
 * Проверка формы массового заполнения табеля. Чистая функция — проверяется
 * тестами; сотрудники, проект и закрытые периоды проверяются в действии.
 */
export interface TimesheetFill {
  dateFrom: Date;
  dateTo: Date;
  dayType: string;
  hours: number;
}

const MAX_DAYS = 366;

function parseDate(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseTimesheetFill(input: {
  employeeCount: number;
  dateFrom: string;
  dateTo: string;
  dayType: string;
  hours: string;
}): TimesheetFill | { error: string } {
  if (input.employeeCount === 0) return { error: "Отметьте хотя бы одного сотрудника" };
  const dateFrom = parseDate(input.dateFrom.trim());
  const dateTo = parseDate(input.dateTo.trim());
  if (!dateFrom || !dateTo) return { error: "Укажите даты «с» и «по»" };
  if (dateTo < dateFrom) return { error: "Дата «по» раньше даты «с»" };
  if ((dateTo.getTime() - dateFrom.getTime()) / 86_400_000 + 1 > MAX_DAYS) return { error: "За один раз — не больше года" };
  if (!(input.dayType in TIME_SHEET_DAY_TYPE_LABELS)) return { error: "Выберите тип дня" };
  const hoursRaw = input.hours.trim().replace(",", ".");
  const hours = hoursRaw === "" ? 0 : Number(hoursRaw);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24) return { error: "Часов в день — от 0 до 24" };
  return { dateFrom, dateTo, dayType: input.dayType, hours };
}

/** Первые числа месяцев, которые задевает период, — для проверки закрытых периодов. */
export function monthsTouched(dateFrom: Date, dateTo: Date): Date[] {
  const months: Date[] = [];
  for (let d = new Date(Date.UTC(dateFrom.getUTCFullYear(), dateFrom.getUTCMonth(), 1)); d <= dateTo; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(new Date(d));
  }
  return months;
}
