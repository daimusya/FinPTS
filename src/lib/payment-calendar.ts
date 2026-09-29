import { toDecimal } from "./money";
import Decimal from "decimal.js";

export interface ExpectedMovement {
  date: Date;
  amount: number | string;
  direction: "INFLOW" | "OUTFLOW";
  /** Время внутри дня «ЧЧ:ММ»; пусто — в течение дня. */
  time?: string | null;
}

export interface CalendarRow {
  date: string;
  inflow: Decimal;
  outflow: Decimal;
  balance: Decimal;
  /** Остаток в худший момент дня, если он ниже остатка на конец дня; иначе null. */
  lowWithinDay: Decimal | null;
  /** Когда остаток опускается до минимума: «ЧЧ:ММ» или null — с начала дня. */
  lowTime: string | null;
}

/** Время платежа «ЧЧ:ММ» из формы; пусто — в течение дня (null). */
export function parseDueTime(raw: unknown): { time: string | null } | { error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { time: null };
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(text);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return { error: "Время оплаты — в формате ЧЧ:ММ, например 10:30" };
  return { time: `${match[1].padStart(2, "0")}:${match[2]}` };
}

/** Порядок по времени внутри дня: со временем — по возрастанию, без времени — после них. */
export function compareDueTime(a: string | null | undefined, b: string | null | undefined): number {
  const x = a || "~";
  const y = b || "~";
  return x < y ? -1 : x > y ? 1 : 0;
}

/** «15.10.2026» или «15.10.2026 в 10:30». */
export function showDueDate(date: Date, time?: string | null): string {
  const day = date.toLocaleDateString("ru-RU", { timeZone: "UTC" });
  return time ? `${day} в ${time}` : day;
}

/**
 * Порядок движений внутри дня — осторожная оценка: платёж без времени
 * считается в начале дня, поступление без времени — в конце; при одинаковом
 * времени сначала платежи. Так видно, хватит ли денег на утренние платежи
 * до дневных поступлений.
 */
function intradayOrderKey(m: Pick<ExpectedMovement, "direction" | "time">): string {
  if (!m.time) return m.direction === "OUTFLOW" ? "" : "~";
  return `${m.time}${m.direction === "OUTFLOW" ? "0" : "1"}`;
}

/**
 * Минимальный остаток внутри дня от остатка на начало дня. Возвращает
 * минимум после каждого движения и время, когда он наступает (null — с
 * начала дня: платёж без времени).
 */
export function intradayLow(
  opening: Decimal,
  movements: Array<Pick<ExpectedMovement, "amount" | "direction" | "time">>,
): { low: Decimal; time: string | null; closing: Decimal } {
  const ordered = [...movements].sort((a, b) => {
    const x = intradayOrderKey(a);
    const y = intradayOrderKey(b);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let running = opening;
  let low: Decimal | null = null;
  let time: string | null = null;
  for (const m of ordered) {
    running = m.direction === "INFLOW" ? running.plus(toDecimal(m.amount)) : running.minus(toDecimal(m.amount));
    if (low === null || running.lessThan(low)) {
      low = running;
      time = m.time ?? null;
    }
  }
  return { low: low ?? opening, time, closing: running };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildCalendarRows(startingBalance: number | string, movements: ExpectedMovement[]): CalendarRow[] {
  const byDate = new Map<string, { inflow: Decimal; outflow: Decimal; list: ExpectedMovement[] }>();

  for (const m of movements) {
    const key = dateKey(m.date);
    const entry = byDate.get(key) ?? { inflow: new Decimal(0), outflow: new Decimal(0), list: [] };
    if (m.direction === "INFLOW") {
      entry.inflow = entry.inflow.plus(toDecimal(m.amount));
    } else {
      entry.outflow = entry.outflow.plus(toDecimal(m.amount));
    }
    entry.list.push(m);
    byDate.set(key, entry);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  let running = toDecimal(startingBalance);
  const rows: CalendarRow[] = [];
  for (const key of sortedDates) {
    const { inflow, outflow, list } = byDate.get(key)!;
    const day = intradayLow(running, list);
    running = day.closing;
    const dips = day.low.lessThan(running);
    rows.push({ date: key, inflow, outflow, balance: running, lowWithinDay: dips ? day.low : null, lowTime: dips ? day.time : null });
  }
  return rows;
}

/** ГГГГ-ММ-ДД по местному времени сервера — «сегодня» для календаря. */
export function localDateKey(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Статусы заявки, которые календарь вообще не показывает. */
export const HIDDEN_REQUEST_STATUSES = ["CANCELLED"] as const;

export interface RequestPlacement {
  /** Показывать в календаре. */
  visible: boolean;
  /** Учитывать в прогнозе остатка (как будущий платёж). */
  counted: boolean;
  /** Можно перенести срок оплаты. */
  movable: boolean;
}

/**
 * Как заявка на оплату участвует в календаре. Отменённые не видны; оплаченные
 * и отклонённые видны, но деньги по ним уже не уйдут (оплата — в банковских
 * операциях), поэтому в прогноз не входят и не переносятся. Черновик и заявка
 * на согласовании — в прогнозе, только если выбран учёт несогласованных.
 */
export function requestPlacement(status: string, includePending: boolean): RequestPlacement {
  switch (status) {
    case "APPROVED":
      return { visible: true, counted: true, movable: true };
    case "PENDING_APPROVAL":
    case "DRAFT":
      return { visible: true, counted: includePending, movable: true };
    case "PAID":
    case "REJECTED":
      return { visible: true, counted: false, movable: false };
    default:
      return { visible: false, counted: false, movable: false };
  }
}

/**
 * Проверка новой даты оплаты: формат ГГГГ-ММ-ДД и не раньше сегодняшнего дня
 * (перенести неоплаченную заявку в прошлое бессмысленно).
 */
export function parseRescheduleDate(raw: unknown, todayKey: string): { date: Date; key: string } | { error: string } {
  const key = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return { error: "Укажите новую дату оплаты" };
  const date = new Date(`${key}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== key) return { error: "Такой даты нет в календаре" };
  if (key < todayKey) return { error: "Срок оплаты нельзя перенести в прошлое" };
  return { date, key };
}

export interface CalendarMovement extends ExpectedMovement {
  source: "document" | "request";
}

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWorking: boolean;
  holidayName: string | null;
  inflow: Decimal;
  outflow: Decimal;
  /** Прогнозный остаток на конец дня; для прошедших дней — null (прогноз строится от сегодня). */
  balance: Decimal | null;
  /** Остаток в худший момент дня, если он ниже остатка на конец дня (платёж раньше поступления). */
  lowWithinDay: Decimal | null;
  /** Когда остаток опускается до минимума: «ЧЧ:ММ» или null — с начала дня. */
  lowTime: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Сетка месяца (недели с понедельника) с прогнозным остатком на конец каждого
 * дня начиная с сегодняшнего. Просроченные движения (срок раньше сегодня)
 * считаются к оплате сегодня: деньги по ним ещё не пришли и не ушли.
 */
export function buildMonthGrid(input: {
  month: string;
  todayKey: string;
  startingBalance: number | string | Decimal;
  movements: CalendarMovement[];
  /** Отклонения от пятидневки: дата → { kind: holiday|workday, name }. */
  calendar: Map<string, { kind: "holiday" | "workday"; name: string | null }>;
}): CalendarDay[][] {
  const [year, month] = input.month.split("-").map(Number);
  const first = Date.UTC(year, month - 1, 1);
  const last = Date.UTC(year, month, 0);
  const mondayOffset = (new Date(first).getUTCDay() + 6) % 7;
  const gridStart = first - mondayOffset * DAY_MS;
  const sundayOffset = (7 - new Date(last).getUTCDay()) % 7;
  const gridEnd = last + sundayOffset * DAY_MS;

  const perDay = new Map<string, { inflow: Decimal; outflow: Decimal; list: CalendarMovement[] }>();
  let carried = toDecimal(input.startingBalance);
  const gridStartKey = keyOf(gridStart);
  for (const m of input.movements) {
    const raw = m.date.toISOString().slice(0, 10);
    const overdue = raw < input.todayKey;
    const key = overdue ? input.todayKey : raw;
    const signed = m.direction === "INFLOW" ? toDecimal(m.amount) : toDecimal(m.amount).negated();
    // Everything due before the visible grid (but not before today) is already in the opening balance.
    if (key < gridStartKey) {
      carried = carried.plus(signed);
      continue;
    }
    const entry = perDay.get(key) ?? { inflow: new Decimal(0), outflow: new Decimal(0), list: [] };
    if (m.direction === "INFLOW") entry.inflow = entry.inflow.plus(toDecimal(m.amount));
    else entry.outflow = entry.outflow.plus(toDecimal(m.amount));
    // An overdue payment is due right away, whatever time it once had.
    entry.list.push(overdue ? { ...m, time: null } : m);
    perDay.set(key, entry);
  }

  const weeks: CalendarDay[][] = [];
  let running = carried;
  for (let ms = gridStart; ms <= gridEnd; ms += DAY_MS) {
    const date = keyOf(ms);
    const entry = perDay.get(date) ?? { inflow: new Decimal(0), outflow: new Decimal(0), list: [] };
    const isPast = date < input.todayKey;
    let lowWithinDay: Decimal | null = null;
    let lowTime: string | null = null;
    if (!isPast) {
      const day = intradayLow(running, entry.list);
      running = day.closing;
      if (day.low.lessThan(running)) {
        lowWithinDay = day.low;
        lowTime = day.time;
      }
    }
    const override = input.calendar.get(date);
    const dow = new Date(ms).getUTCDay();
    const isWorking = override ? override.kind === "workday" : dow !== 0 && dow !== 6;
    if (weeks.length === 0 || weeks[weeks.length - 1].length === 7) weeks.push([]);
    weeks[weeks.length - 1].push({
      date,
      day: new Date(ms).getUTCDate(),
      inMonth: ms >= first && ms <= last,
      isToday: date === input.todayKey,
      isPast,
      isWorking,
      holidayName: override?.kind === "holiday" ? override.name : null,
      inflow: entry.inflow,
      outflow: entry.outflow,
      balance: isPast ? null : running,
      lowWithinDay,
      lowTime,
    });
  }
  return weeks;
}

/** Соседние месяцы для навигации: «2026-10» → { prev: «2026-09», next: «2026-11» }. */
export function adjacentMonths(month: string): { prev: string; next: string } {
  const [y, m] = month.split("-").map(Number);
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 7);
  return { prev: fmt(Date.UTC(y, m - 2, 1)), next: fmt(Date.UTC(y, m, 1)) };
}

/** Счёт оплаты одной строкой для форм и фильтров: «bank:ID» или «cash:ID». */
export function accountKey(bankAccountId: string | null | undefined, cashAccountId: string | null | undefined): string | null {
  if (bankAccountId) return `bank:${bankAccountId}`;
  if (cashAccountId) return `cash:${cashAccountId}`;
  return null;
}

export function parseAccountKey(key: unknown): { bankAccountId: string | null; cashAccountId: string | null } | null {
  const raw = String(key ?? "");
  const match = /^(bank|cash):([A-Za-z0-9_-]{1,64})$/.exec(raw);
  if (!match) return null;
  return match[1] === "bank" ? { bankAccountId: match[2], cashAccountId: null } : { bankAccountId: null, cashAccountId: match[2] };
}

export interface ScopedItem {
  organizationId: string;
  accountKey: string | null;
}

export interface ForecastScope {
  organizationId: string | null;
  accountKey: string | null;
  /** Организация выбранного счёта — её платежи без счёта показываются как «счёт не назначен». */
  accountOrganizationId: string | null;
}

/**
 * Попадает ли платёж в прогноз выбранного среза. По счёту — только платежи с
 * этим счётом оплаты; платежи той же организации без счёта — «unassigned»
 * (видны отдельно, в прогноз счёта не входят). По организации — все её платежи.
 */
export function itemScope(item: ScopedItem, scope: ForecastScope): "in" | "unassigned" | "out" {
  if (scope.accountKey) {
    if (item.accountKey === scope.accountKey) return "in";
    if (!item.accountKey && item.organizationId === scope.accountOrganizationId) return "unassigned";
    return "out";
  }
  if (scope.organizationId) return item.organizationId === scope.organizationId ? "in" : "out";
  return "in";
}
