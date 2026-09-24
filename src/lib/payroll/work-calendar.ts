import Decimal from "decimal.js";

/** Отклонения производственного календаря от «пн–пт рабочие»: дата ГГГГ-ММ-ДД → вид. */
export type CalendarOverrides = Map<string, "holiday" | "workday">;

/**
 * Виды дней табеля, когда работник не работал за оклад: отпуск и больничный
 * оплачиваются отдельно по среднему заработку / пособием, командировка — по
 * среднему заработку, отсутствие не оплачивается.
 */
export const ABSENCE_DAY_TYPES = ["vacation", "sick_leave", "business_trip", "absence"] as const;
/** Виды дней табеля, означающие работу (перекрывают отметку об отсутствии в тот же день). */
export const WORK_DAY_TYPES = ["work", "overtime", "project"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

export function isWorkingDay(date: Date, calendar: CalendarOverrides): boolean {
  const override = calendar.get(date.toISOString().slice(0, 10));
  if (override) return override === "workday";
  const dow = date.getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** Рабочие дни (ГГГГ-ММ-ДД) в диапазоне дат включительно. */
export function workingDays(from: Date, to: Date, calendar: CalendarOverrides): string[] {
  const days: string[] = [];
  for (let ms = utcDay(from); ms <= utcDay(to); ms += DAY_MS) {
    if (isWorkingDay(new Date(ms), calendar)) days.push(iso(ms));
  }
  return days;
}

export interface ProratedSalaryInput {
  salary: Decimal;
  year: number;
  month: number;
  /** full — оклад за месяц; firstHalf — аванс за дни с 1 по 15 число. */
  part: "full" | "firstHalf";
  hireDate: Date;
  terminationDate: Date | null;
  calendar: CalendarOverrides;
  /** Годы, для которых производственный календарь заполнен. */
  calendarYears: Set<number>;
  /** Отметки табеля сотрудника: дата ГГГГ-ММ-ДД → виды дня. */
  timesheet: Map<string, Set<string>>;
}

export interface ProratedSalaryResult {
  /** Норма рабочих дней в месяце по календарю. */
  normDays: number;
  /** Рабочие дни в части месяца, когда сотрудник числился в штате. */
  scheduledDays: number;
  /** Пропущенные рабочие дни по видам отсутствия. */
  absentByType: Record<string, number>;
  workedDays: number;
  amount: Decimal;
  comment: string;
}

const ABSENCE_LABELS: Record<string, string> = {
  vacation: "отпуск",
  sick_leave: "больничный",
  business_trip: "командировка",
  absence: "отсутствие",
};

/**
 * Оклад пропорционально отработанному времени: оклад × отработанные
 * рабочие дни / норма рабочих дней месяца по производственному календарю.
 * Табель ведётся «по отклонениям»: рабочий день без отметки считается
 * отработанным, не отработан — только отмеченный отпуском, больничным,
 * командировкой или отсутствием (если в тот же день нет отметки о работе).
 * Дни до приёма и после увольнения не оплачиваются. Аванс — то же за дни
 * с 1 по 15 число (ст. 136 ТК РФ: за фактически отработанное время).
 */
export function computeProratedSalary(input: ProratedSalaryInput): ProratedSalaryResult {
  if (!input.calendarYears.has(input.year)) {
    throw new Error(
      `Производственный календарь на ${input.year} год не заполнен — добавьте праздники и переносы в справочнике «Производственный календарь»`,
    );
  }
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 0));
  const normDays = workingDays(monthStart, monthEnd, input.calendar).length;

  const partEnd = input.part === "firstHalf" ? new Date(Date.UTC(input.year, input.month - 1, 15)) : monthEnd;
  const from = Math.max(monthStart.getTime(), utcDay(input.hireDate));
  const to = Math.min(partEnd.getTime(), input.terminationDate ? utcDay(input.terminationDate) : Infinity);
  const scheduled = from <= to ? workingDays(new Date(from), new Date(to), input.calendar) : [];

  const absentByType: Record<string, number> = {};
  let workedDays = 0;
  for (const day of scheduled) {
    const marks = input.timesheet.get(day);
    const worked = !marks || WORK_DAY_TYPES.some((t) => marks.has(t));
    const absence = marks && ABSENCE_DAY_TYPES.find((t) => marks.has(t));
    if (worked || !absence) {
      workedDays += 1;
    } else {
      absentByType[absence] = (absentByType[absence] ?? 0) + 1;
    }
  }

  const amount =
    normDays === 0 ? new Decimal(0) : input.salary.times(workedDays).dividedBy(normDays).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const details = [
    ...Object.entries(absentByType).map(([type, n]) => `${ABSENCE_LABELS[type] ?? type} ${n}`),
    ...(scheduled.length < (input.part === "full" ? normDays : workingDays(monthStart, partEnd, input.calendar).length)
      ? ["не в штате часть периода"]
      : []),
  ];
  const period = input.part === "firstHalf" ? " с 1 по 15 число" : "";
  const comment = `Отработано ${workedDays} из ${normDays} раб. дн. месяца${period}${details.length ? ` (${details.join(", ")})` : ""}`;

  return { normDays, scheduledDays: scheduled.length, absentByType, workedDays, amount, comment };
}
