import Decimal from "decimal.js";

/**
 * Отклонения производственного календаря от «пн–пт рабочие»: дата ГГГГ-ММ-ДД → вид.
 * holiday — нерабочий будний день, workday — рабочий выходной, short —
 * сокращённый на час предпраздничный рабочий день (ст. 95 ТК РФ).
 */
export type CalendarDayKind = "holiday" | "workday" | "short";
export type CalendarOverrides = Map<string, CalendarDayKind>;

/** Строки справочника «Производственный календарь» → отклонения. */
export function toCalendarOverrides(rows: Array<{ date: Date; kind: string }>): CalendarOverrides {
  return new Map(
    rows.map((r) => [r.date.toISOString().slice(0, 10), r.kind === "workday" || r.kind === "short" ? (r.kind as CalendarDayKind) : "holiday"]),
  );
}

/** Нерабочие праздничные дни по ст. 112 ТК РФ (ММ-ДД) — для сменщиков, работающих в праздник по графику. */
export const PUBLIC_HOLIDAYS = ["01-01", "01-02", "01-03", "01-04", "01-05", "01-06", "01-07", "01-08", "02-23", "03-08", "05-01", "05-09", "06-12", "11-04"];
export const isPublicHoliday = (dateKey: string) => PUBLIC_HOLIDAYS.includes(dateKey.slice(5));

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
  if (override) return override !== "holiday";
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

// ---------------------------------------------------------------------------
// Графики работы
// ---------------------------------------------------------------------------

/**
 * График работы: пятидневка по производственному календарю или сменный
 * («N через M» от даты начала цикла — сменщики работают по своему графику
 * независимо от выходных и праздников).
 */
export interface WorkScheduleRule {
  kind: "five_day" | "shift";
  /** Часов в рабочем дне / смене (для пятидневки — 8 при 40-часовой неделе). */
  hoursPerDay: Decimal;
  cycleOn?: number | null;
  cycleOff?: number | null;
  anchorDate?: Date | null;
}

export const FIVE_DAY_WEEK: WorkScheduleRule = { kind: "five_day", hoursPerDay: new Decimal(8) };

/** Правило графика из записи справочника (без графика — пятидневка по 8 часов). */
export function scheduleRule(
  row: { kind: string; hoursPerDay: Decimal | string | number; cycleOn: number | null; cycleOff: number | null; anchorDate: Date | null } | null,
): WorkScheduleRule {
  if (!row) return FIVE_DAY_WEEK;
  const hoursPerDay = new Decimal(row.hoursPerDay.toString());
  if (row.kind === "shift" && row.cycleOn && row.cycleOff && row.anchorDate) {
    return { kind: "shift", hoursPerDay, cycleOn: row.cycleOn, cycleOff: row.cycleOff, anchorDate: row.anchorDate };
  }
  return { kind: "five_day", hoursPerDay };
}

/** Рабочий ли день по графику сотрудника. */
export function isScheduledDay(date: Date, rule: WorkScheduleRule, calendar: CalendarOverrides): boolean {
  if (rule.kind === "five_day") return isWorkingDay(date, calendar);
  const cycle = rule.cycleOn! + rule.cycleOff!;
  const offset = Math.round((utcDay(date) - utcDay(rule.anchorDate!)) / DAY_MS);
  return ((offset % cycle) + cycle) % cycle < rule.cycleOn!;
}

/** Рабочие дни / смены по графику (ГГГГ-ММ-ДД) в диапазоне включительно. */
export function scheduledDays(from: Date, to: Date, rule: WorkScheduleRule, calendar: CalendarOverrides): string[] {
  const days: string[] = [];
  for (let ms = utcDay(from); ms <= utcDay(to); ms += DAY_MS) {
    if (isScheduledDay(new Date(ms), rule, calendar)) days.push(iso(ms));
  }
  return days;
}

/** Часов в рабочем дне по графику: у пятидневки предпраздничный день короче на час. */
export function dayHours(dateKey: string, rule: WorkScheduleRule, calendar: CalendarOverrides): Decimal {
  if (rule.kind === "five_day" && calendar.get(dateKey) === "short") return Decimal.max(rule.hoursPerDay.minus(1), 0);
  return rule.hoursPerDay;
}

/** Норма рабочего времени месяца по графику: дни (смены) и часы. */
export function monthWorkNorm(year: number, month: number, rule: WorkScheduleRule, calendar: CalendarOverrides): { days: number; hours: Decimal } {
  const days = scheduledDays(new Date(Date.UTC(year, month - 1, 1)), new Date(Date.UTC(year, month, 0)), rule, calendar);
  return { days: days.length, hours: days.reduce((sum, d) => sum.plus(dayHours(d, rule, calendar)), new Decimal(0)) };
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
  /** График работы; по умолчанию — пятидневка по производственному календарю. */
  schedule?: WorkScheduleRule;
}

export interface ProratedSalaryResult {
  /** Норма рабочих дней в месяце по календарю. */
  normDays: number;
  /** Рабочие дни в части месяца, когда сотрудник числился в штате. */
  scheduledDays: number;
  /** Пропущенные рабочие дни по видам отсутствия. */
  absentByType: Record<string, number>;
  workedDays: number;
  /** Отработанные часы в рабочие дни по графику (для доплат за выходные сверх нормы). */
  workedHours: Decimal;
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
  const rule = input.schedule ?? FIVE_DAY_WEEK;
  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 0));
  const normDays = scheduledDays(monthStart, monthEnd, rule, input.calendar).length;

  const partEnd = input.part === "firstHalf" ? new Date(Date.UTC(input.year, input.month - 1, 15)) : monthEnd;
  const from = Math.max(monthStart.getTime(), utcDay(input.hireDate));
  const to = Math.min(partEnd.getTime(), input.terminationDate ? utcDay(input.terminationDate) : Infinity);
  const scheduled = from <= to ? scheduledDays(new Date(from), new Date(to), rule, input.calendar) : [];

  const absentByType: Record<string, number> = {};
  let workedDays = 0;
  let workedHours = new Decimal(0);
  for (const day of scheduled) {
    const marks = input.timesheet.get(day);
    const worked = !marks || WORK_DAY_TYPES.some((t) => marks.has(t));
    const absence = marks && ABSENCE_DAY_TYPES.find((t) => marks.has(t));
    if (worked || !absence) {
      workedDays += 1;
      workedHours = workedHours.plus(dayHours(day, rule, input.calendar));
    } else {
      absentByType[absence] = (absentByType[absence] ?? 0) + 1;
    }
  }

  const amount =
    normDays === 0 ? new Decimal(0) : input.salary.times(workedDays).dividedBy(normDays).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const details = [
    ...Object.entries(absentByType).map(([type, n]) => `${ABSENCE_LABELS[type] ?? type} ${n}`),
    ...(scheduled.length < (input.part === "full" ? normDays : scheduledDays(monthStart, partEnd, rule, input.calendar).length)
      ? ["не в штате часть периода"]
      : []),
  ];
  const period = input.part === "firstHalf" ? " с 1 по 15 число" : "";
  const unit = rule.kind === "shift" ? "смен" : "раб. дн.";
  const comment = `Отработано ${workedDays} из ${normDays} ${unit} месяца${period}${details.length ? ` (${details.join(", ")})` : ""}`;

  return { normDays, scheduledDays: scheduled.length, absentByType, workedDays, workedHours, amount, comment };
}

// ---------------------------------------------------------------------------
// Сверхурочные и работа в выходные и праздники
// ---------------------------------------------------------------------------

export interface ExtraPayInput {
  salary: Decimal;
  year: number;
  month: number;
  schedule: WorkScheduleRule;
  calendar: CalendarOverrides;
  hireDate: Date;
  terminationDate: Date | null;
  /** Табель: дата → вид дня → часы (0 — не указаны). */
  hours: Map<string, Map<string, Decimal>>;
  /** Отработанные часы в рабочие дни по графику (из расчёта оклада). */
  workedRegularHours: Decimal;
}

export interface ExtraPayResult {
  normHours: Decimal;
  hourlyRate: Decimal;
  overtime: { days: number; hours: Decimal; amount: Decimal };
  weekend: { days: number; hours: Decimal; withinNormHours: Decimal; beyondNormHours: Decimal; amount: Decimal };
}

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Доплаты окладнику сверх оклада. Часовая ставка = оклад / норма часов месяца
 * по графику (с сокращёнными предпраздничными днями).
 * — Сверхурочные (ст. 152 ТК РФ) — отметки «Сверхурочные» в рабочие дни:
 *   первые 2 часа за день — в полуторном, остальные — в двойном размере.
 * — Работа в выходной или праздник (ст. 153 ТК РФ) — отметка о работе в
 *   нерабочий по графику день, а у сменщика — и смена в праздник: сверх
 *   оклада одинарная ставка, если с ней не превышена месячная норма часов,
 *   и двойная — за часы сверх нормы.
 */
export function computeExtraPay(input: ExtraPayInput): ExtraPayResult {
  const norm = monthWorkNorm(input.year, input.month, input.schedule, input.calendar);
  const hourlyRate = norm.hours.isZero() ? new Decimal(0) : input.salary.dividedBy(norm.hours);
  const first = Math.max(Date.UTC(input.year, input.month - 1, 1), utcDay(input.hireDate));
  const last = Math.min(Date.UTC(input.year, input.month, 0), input.terminationDate ? utcDay(input.terminationDate) : Infinity);

  let overtimeDays = 0;
  let overtimeHours = new Decimal(0);
  let overtimeAmount = new Decimal(0);
  let weekendDays = 0;
  let weekendHours = new Decimal(0);
  let shiftHolidayHours = new Decimal(0);
  for (let ms = first; ms <= last; ms += DAY_MS) {
    const key = iso(ms);
    const marks = input.hours.get(key);
    const scheduled = isScheduledDay(new Date(ms), input.schedule, input.calendar);
    const hoursOf = (type: string) => {
      const h = marks?.get(type);
      return h && h.greaterThan(0) ? h : null;
    };
    const workMarked = marks && WORK_DAY_TYPES.some((t) => marks.has(t));
    if (!scheduled) {
      if (!workMarked) continue;
      const hours = WORK_DAY_TYPES.reduce<Decimal>((sum, t) => sum.plus(hoursOf(t) ?? 0), new Decimal(0));
      weekendDays += 1;
      weekendHours = weekendHours.plus(hours.greaterThan(0) ? hours : input.schedule.hoursPerDay);
      continue;
    }
    const absent = marks && !workMarked && ABSENCE_DAY_TYPES.some((t) => marks.has(t));
    // A shift worker's scheduled shift on a public holiday is holiday work (ст. 153).
    if (input.schedule.kind === "shift" && isPublicHoliday(key) && !absent) {
      const h = dayHours(key, input.schedule, input.calendar);
      weekendDays += 1;
      weekendHours = weekendHours.plus(h);
      shiftHolidayHours = shiftHolidayHours.plus(h);
    }
    const overtime = hoursOf("overtime");
    if (overtime) {
      overtimeDays += 1;
      overtimeHours = overtimeHours.plus(overtime);
      const firstTwo = Decimal.min(overtime, 2);
      overtimeAmount = overtimeAmount.plus(hourlyRate.times(firstTwo.times(1.5).plus(overtime.minus(firstTwo).times(2))));
    }
  }

  // A shift worker's holiday shifts are already inside the regular hours — don't count them twice against the norm.
  const regular = input.workedRegularHours.minus(shiftHolidayHours);
  const room = Decimal.max(norm.hours.minus(regular), 0);
  const withinNormHours = Decimal.min(weekendHours, room);
  const beyondNormHours = weekendHours.minus(withinNormHours);
  const weekendAmount = hourlyRate.times(withinNormHours.plus(beyondNormHours.times(2)));

  return {
    normHours: norm.hours,
    hourlyRate: hourlyRate.toDecimalPlaces(4, Decimal.ROUND_HALF_UP),
    overtime: { days: overtimeDays, hours: overtimeHours, amount: round2(overtimeAmount) },
    weekend: { days: weekendDays, hours: weekendHours, withinNormHours, beyondNormHours, amount: round2(weekendAmount) },
  };
}

// ---------------------------------------------------------------------------
// Командировка по среднему заработку
// ---------------------------------------------------------------------------

export interface TripPayInput {
  tripDays: number;
  /** Заработок за 12 месяцев расчётного периода (учитываемые выплаты). */
  totalEarnings: Decimal;
  /** Фактически отработанные дни в расчётном периоде (по графику, без отпусков, болезней, командировок и отсутствий). */
  workedDays: number;
  /** На случай пустого периода: оклад / норма дней месяца командировки. */
  salary: Decimal | null;
  monthNormDays: number;
}

/**
 * Оплата дней командировки по среднему заработку (ст. 167 ТК РФ, п. 9
 * Положения № 922): заработок за 12 месяцев / фактически отработанные в них
 * дни × рабочие дни командировки по графику. Без заработка и отработанных
 * дней в периоде — по окладу за день месяца командировки.
 */
export function computeTripPay(input: TripPayInput): { avgDaily: Decimal; amount: Decimal; method: "average" | "salary" } {
  if (input.workedDays > 0 && input.totalEarnings.greaterThan(0)) {
    const avgDaily = round2(input.totalEarnings.dividedBy(input.workedDays));
    return { avgDaily, amount: round2(avgDaily.times(input.tripDays)), method: "average" };
  }
  if (input.salary && input.monthNormDays > 0) {
    const avgDaily = round2(input.salary.dividedBy(input.monthNormDays));
    return { avgDaily, amount: round2(avgDaily.times(input.tripDays)), method: "salary" };
  }
  throw new Error("Для командировки нет ни заработка за 12 месяцев, ни оклада");
}
