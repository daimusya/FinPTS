import Decimal from "decimal.js";
import { formatMoney, toDecimal, type MoneyInput } from "@/lib/money";
import { compareDueTime, parseDueTime } from "@/lib/payment-calendar";
import { yearProblem } from "@/lib/form-values";

export const MAX_PAYMENT_PARTS = 24;

export interface ScheduleRowInput {
  /** Существующая часть (при правке графика) или пусто для новой. */
  id: string | null;
  dueDate: string;
  /** Время «ЧЧ:ММ» или пусто — в течение дня. */
  dueTime?: string;
  amount: string;
}

export interface ScheduleRow {
  id: string | null;
  dueDate: Date;
  dueKey: string;
  dueTime: string | null;
  amount: string;
}

/** Строки графика из формы: параллельные поля partId / partDueDate / partDueTime / partAmount. */
export function readScheduleRows(ids: unknown[], dates: unknown[], amounts: unknown[], times: unknown[] = []): ScheduleRowInput[] {
  const rows: ScheduleRowInput[] = [];
  for (let i = 0; i < Math.max(dates.length, amounts.length); i++) {
    const dueDate = String(dates[i] ?? "").trim();
    const amount = String(amounts[i] ?? "").trim();
    if (!dueDate && !amount) continue; // an empty row left in the editor
    rows.push({ id: String(ids[i] ?? "").trim() || null, dueDate, dueTime: String(times[i] ?? "").trim(), amount });
  }
  return rows;
}

/**
 * Проверка графика оплаты: сумма неоплаченных частей плюс уже оплаченные
 * равна сумме заявки (до копейки), у каждой части положительная сумма и дата
 * не раньше сегодняшней. Без оплаченных частей график — минимум две части
 * (одна часть — это просто оплата целиком).
 */
export function validateSchedule(input: {
  requestAmount: MoneyInput;
  paidAmounts: MoneyInput[];
  rows: ScheduleRowInput[];
  todayKey: string;
}): { rows: ScheduleRow[] } | { error: string } {
  const { rows, todayKey } = input;
  if (rows.length === 0) return { error: "Добавьте хотя бы одну часть оплаты" };
  if (input.paidAmounts.length === 0 && rows.length < 2) {
    return { error: "График — это минимум две части. Чтобы платить одной суммой, объедините график" };
  }
  if (rows.length + input.paidAmounts.length > MAX_PAYMENT_PARTS) return { error: `Не больше ${MAX_PAYMENT_PARTS} частей` };

  const parsed: ScheduleRow[] = [];
  for (const [i, row] of rows.entries()) {
    const n = i + 1;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dueDate)) return { error: `Часть ${n}: укажите дату оплаты` };
    const dueDate = new Date(`${row.dueDate}T00:00:00.000Z`);
    if (Number.isNaN(dueDate.getTime()) || dueDate.toISOString().slice(0, 10) !== row.dueDate) return { error: `Часть ${n}: такой даты нет` };
    if (row.dueDate < todayKey) return { error: `Часть ${n}: дата оплаты не может быть в прошлом` };
    const year = yearProblem(row.dueDate);
    if (year) return { error: `Часть ${n}: ${year}` };
    const time = parseDueTime(row.dueTime);
    if ("error" in time) return { error: `Часть ${n}: ${time.error.charAt(0).toLowerCase()}${time.error.slice(1)}` };
    const amountRaw = row.amount.replace(/\s/g, "").replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || toDecimal(amountRaw).lessThanOrEqualTo(0)) {
      return { error: `Часть ${n}: сумма должна быть положительной, не больше двух знаков после запятой` };
    }
    parsed.push({ id: row.id, dueDate, dueKey: row.dueDate, dueTime: time.time, amount: toDecimal(amountRaw).toFixed(2) });
  }

  const paid = input.paidAmounts.reduce<Decimal>((sum, a) => sum.plus(toDecimal(a)), new Decimal(0));
  const planned = parsed.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
  const total = toDecimal(input.requestAmount);
  const diff = total.minus(paid).minus(planned);
  if (!diff.isZero()) {
    const left = formatMoney(total.minus(paid));
    return {
      error: diff.greaterThan(0)
        ? `Части в сумме меньше заявки на ${formatMoney(diff)} — к оплате осталось ${left}`
        : `Части в сумме больше заявки на ${formatMoney(diff.negated())} — к оплате осталось ${left}`,
    };
  }
  // By date, then by time; a part without a time goes after the timed ones of that day.
  return { rows: parsed.sort((a, b) => a.dueKey.localeCompare(b.dueKey) || compareDueTime(a.dueTime, b.dueTime)) };
}

export interface PartState {
  dueDate: Date;
  amount: MoneyInput;
  paidAt: Date | null;
}

/** Сводка по графику: ближайший неоплаченный срок, оплачено/осталось, всё ли оплачено. */
export function scheduleSummary(parts: PartState[]) {
  const unpaid = parts.filter((p) => !p.paidAt).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const paid = parts.filter((p) => p.paidAt);
  const sum = (list: PartState[]) => list.reduce<Decimal>((s, p) => s.plus(toDecimal(p.amount)), new Decimal(0));
  return {
    total: parts.length,
    paidCount: paid.length,
    paidAmount: sum(paid),
    remainingAmount: sum(unpaid),
    nextDueDate: unpaid[0]?.dueDate ?? null,
    allPaid: parts.length > 0 && unpaid.length === 0,
  };
}

/**
 * Черновик графика для редактора: сумма поровну на n частей (остаток копеек —
 * в последнюю), даты — от срока заявки с шагом stepDays.
 */
export function suggestSplit(amount: MoneyInput, firstDueKey: string, parts = 2, stepDays = 7): ScheduleRowInput[] {
  const total = toDecimal(amount);
  const share = total.dividedBy(parts).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  const start = Date.UTC(Number(firstDueKey.slice(0, 4)), Number(firstDueKey.slice(5, 7)) - 1, Number(firstDueKey.slice(8, 10)));
  return Array.from({ length: parts }, (_, i) => ({
    id: null,
    dueDate: new Date(start + i * stepDays * 86_400_000).toISOString().slice(0, 10),
    dueTime: "",
    amount: (i === parts - 1 ? total.minus(share.times(parts - 1)) : share).toFixed(2),
  }));
}
