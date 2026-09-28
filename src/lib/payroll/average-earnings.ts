import Decimal from "decimal.js";
import { sumMoney, toDecimal } from "@/lib/money";

/** Среднемесячное число календарных дней (п. 10 Положения, утв. Постановлением Правительства РФ № 922). */
export const AVG_DAYS_PER_MONTH = new Decimal("29.3");
/** Делитель для пособия по нетрудоспособности (ч. 3 ст. 14 Закона № 255-ФЗ). */
export const SICK_LEAVE_DIVISOR = 730;
/** Первые 3 дня болезни оплачивает работодатель, остальные — Социальный фонд напрямую. */
export const EMPLOYER_PAID_SICK_DAYS = 3;
/**
 * Дни табеля, исключаемые из расчётного периода для отпускных вместе с
 * начислениями за них (п. 5 Положения № 922): отпуск, болезнь и
 * командировка — время, когда за работником сохранялся средний заработок
 * или он получал пособие.
 */
export const EXCLUDED_DAY_TYPES = ["vacation", "sick_leave", "business_trip"] as const;

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Месяц, за который начислен заработок строки расчёта. Окончательный
 * расчёт выплачивается 10-го за предыдущий месяц, аванс и разовые
 * выплаты относятся к месяцу выплаты.
 */
export function earningsMonth(kind: "ADVANCE" | "FINAL" | "ADHOC", payoutDate: Date): { year: number; month: number } {
  const shift = kind === "FINAL" ? -1 : 0;
  const total = payoutDate.getUTCFullYear() * 12 + payoutDate.getUTCMonth() + shift;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

// ---------------------------------------------------------------------------
// История окладов и страховой стаж
// ---------------------------------------------------------------------------

/** Изменение оклада с даты date: from → to (from = null — оклад при приёме). */
export interface SalaryChange {
  date: Date;
  from: Decimal | null;
  to: Decimal;
}

/**
 * Оклад, действовавший на дату: последнее изменение не позже даты; до
 * первого изменения — его «было» (или текущий оклад, если история пуста).
 */
export function salaryAt(changes: SalaryChange[], date: Date, fallback: Decimal | null): Decimal | null {
  const sorted = [...changes].sort((a, b) => a.date.getTime() - b.date.getTime());
  const day = utcDay(date);
  let current: Decimal | null = sorted.length > 0 ? (sorted[0].from ?? fallback) : fallback;
  for (const change of sorted) if (utcDay(change.date) <= day) current = change.to;
  return current;
}

/**
 * Страховой стаж на дату: стаж до приёма (месяцев) плюс полные месяцы работы
 * у нас. Процент пособия (ст. 7 Закона № 255-ФЗ): до 5 лет — 60, от 5 до 8 —
 * 80, от 8 лет — 100; меньше 6 месяцев — ещё и не больше МРОТ за месяц.
 */
export function insuranceTenure(priorMonths: number, hireDate: Date, onDate: Date): { months: number; pct: InsuranceTenurePct; short: boolean } {
  const worked =
    (onDate.getUTCFullYear() - hireDate.getUTCFullYear()) * 12 +
    (onDate.getUTCMonth() - hireDate.getUTCMonth()) -
    (onDate.getUTCDate() < hireDate.getUTCDate() ? 1 : 0);
  const months = Math.max(0, priorMonths) + Math.max(0, worked);
  const pct: InsuranceTenurePct = months >= 96 ? 100 : months >= 60 ? 80 : 60;
  return { months, pct, short: months < 6 };
}

// ---------------------------------------------------------------------------
// Отпускные
// ---------------------------------------------------------------------------

export interface VacationInput {
  vacationStart: Date;
  vacationDays: number;
  hireDate: Date;
  /** Начисления, учитываемые в среднем заработке, по месяцам: ключ monthKey(). */
  earningsByMonth: Map<string, Decimal>;
  /** Даты (ГГГГ-ММ-ДД) отпуска, болезни и командировок по табелю. */
  excludedDates: Set<string>;
  /** Оклад — на случай, если в расчётном периоде нет ни заработка, ни отработанных дней. */
  salary: Decimal | null;
  /**
   * Индексация при повышении окладов (п. 16 Положения № 922) — задаётся,
   * только если оклады повышены в организации (подразделении). indexableByMonth —
   * часть заработка месяца, зависящая от оклада (оклад, аванс): премии
   * фиксированной суммой не индексируются.
   */
  indexation?: { changes: SalaryChange[]; indexableByMonth: Map<string, Decimal> };
}

export interface VacationMonthRow {
  year: number;
  month: number;
  calendarDays: number;
  employedDays: number;
  excludedDays: number;
  countedDays: Decimal;
  earnings: Decimal;
  /** Коэффициент индексации месяца (новый оклад / оклад месяца); null — не индексировался. */
  indexCoef: Decimal | null;
  /** Заработок месяца после индексации окладной части. */
  indexedEarnings: Decimal;
}

export interface VacationResult {
  months: VacationMonthRow[];
  totalEarnings: Decimal;
  totalDays: Decimal;
  avgDaily: Decimal;
  amount: Decimal;
  /** average — по фактическому заработку; salary — по окладу (п. 8 Положения № 922). */
  method: "average" | "salary";
  /** Средний дневной до повышения после расчётного периода и коэффициент этого повышения. */
  afterPeriod: { avgDailyBefore: Decimal; coef: Decimal; date: Date } | null;
  /** Дни отпуска после повышения оклада во время отпуска — оплачены с коэффициентом. */
  duringVacation: Array<{ date: Date; days: number; coef: Decimal }>;
}

/**
 * Отпускные по ст. 139 ТК РФ и Положению № 922: заработок за 12
 * календарных месяцев перед месяцем начала отпуска делится на число
 * дней расчётного периода (29,3 за полностью отработанный месяц,
 * пропорционально — за неполный), средний дневной заработок умножается
 * на число календарных дней отпуска.
 */
export function computeVacationPay(input: VacationInput): VacationResult {
  if (!Number.isInteger(input.vacationDays) || input.vacationDays < 1) {
    throw new Error("Число дней отпуска должно быть целым положительным");
  }
  const startYear = input.vacationStart.getUTCFullYear();
  const startMonth = input.vacationStart.getUTCMonth() + 1;
  const hireDay = utcDay(input.hireDate);

  const months: VacationMonthRow[] = [];
  for (let offset = 12; offset >= 1; offset -= 1) {
    const total = startYear * 12 + (startMonth - 1) - offset;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const calendarDays = daysInMonth(year, month);
    const monthStart = Date.UTC(year, month - 1, 1);
    const monthEnd = Date.UTC(year, month - 1, calendarDays);
    const from = Math.max(monthStart, hireDay);

    let employedDays = 0;
    let excludedDays = 0;
    for (let day = from; day <= monthEnd; day += DAY_MS) {
      employedDays += 1;
      if (input.excludedDates.has(new Date(day).toISOString().slice(0, 10))) excludedDays += 1;
    }
    const worked = employedDays - excludedDays;
    const countedDays =
      worked <= 0
        ? new Decimal(0)
        : worked === calendarDays
          ? AVG_DAYS_PER_MONTH
          : AVG_DAYS_PER_MONTH.times(worked).dividedBy(calendarDays);

    const earnings = input.earningsByMonth.get(monthKey(year, month)) ?? toDecimal(0);
    months.push({ year, month, calendarDays, employedDays, excludedDays, countedDays, earnings, indexCoef: null, indexedEarnings: earnings });
  }

  // п. 16: повышение внутри расчётного периода — окладная часть месяцев до
  // повышения умножается на «оклад в конце периода / оклад в месяце».
  const periodEnd = new Date(Date.UTC(startYear, startMonth - 1, 0));
  const idx = input.indexation;
  const salaryEnd = idx ? salaryAt(idx.changes, periodEnd, input.salary) : null;
  if (idx && salaryEnd) {
    for (const m of months) {
      const salaryMonth = salaryAt(idx.changes, new Date(Date.UTC(m.year, m.month, 0)), input.salary);
      const indexable = idx.indexableByMonth.get(monthKey(m.year, m.month)) ?? toDecimal(0);
      if (!salaryMonth || !salaryMonth.greaterThan(0) || !salaryEnd.greaterThan(salaryMonth) || indexable.isZero()) continue;
      m.indexCoef = salaryEnd.dividedBy(salaryMonth);
      m.indexedEarnings = round2(m.earnings.plus(indexable.times(m.indexCoef.minus(1))));
    }
  }

  const totalEarnings = sumMoney(months.map((m) => m.indexedEarnings));
  const totalDays = months.reduce((acc, m) => acc.plus(m.countedDays), new Decimal(0));

  let avgDaily: Decimal;
  let method: VacationResult["method"];
  if (totalDays.greaterThan(0) && totalEarnings.greaterThan(0)) {
    avgDaily = round2(totalEarnings.dividedBy(totalDays));
    method = "average";
  } else if (input.salary && input.salary.greaterThan(0)) {
    avgDaily = round2(input.salary.dividedBy(AVG_DAYS_PER_MONTH));
    method = "salary";
  } else {
    throw new Error("В расчётном периоде нет ни начислений, ни отработанных дней, и у сотрудника не задан оклад");
  }

  // п. 16: повышение после расчётного периода, до начала отпуска — индексируется весь средний.
  let afterPeriod: VacationResult["afterPeriod"] = null;
  const salaryStart = idx ? salaryAt(idx.changes, input.vacationStart, input.salary) : null;
  if (idx && method === "average" && salaryEnd && salaryStart && salaryStart.greaterThan(salaryEnd)) {
    const coef = salaryStart.dividedBy(salaryEnd);
    const raise = idx.changes.filter((c) => utcDay(c.date) > utcDay(periodEnd) && utcDay(c.date) <= utcDay(input.vacationStart)).at(-1)!;
    afterPeriod = { avgDailyBefore: avgDaily, coef, date: raise.date };
    avgDaily = round2(avgDaily.times(coef));
  }

  // п. 16: повышение во время отпуска — дни с даты повышения оплачиваются с коэффициентом.
  const duringVacation: VacationResult["duringVacation"] = [];
  let amount = new Decimal(0);
  const startDay = utcDay(input.vacationStart);
  for (let i = 0; i < input.vacationDays; i++) {
    const day = new Date(startDay + i * DAY_MS);
    let rate = avgDaily;
    if (idx && salaryStart && salaryStart.greaterThan(0)) {
      const salaryDay = salaryAt(idx.changes, day, input.salary);
      if (salaryDay && salaryDay.greaterThan(salaryStart)) {
        const coef = salaryDay.dividedBy(salaryStart);
        rate = round2(avgDaily.times(coef));
        const last = duringVacation.at(-1);
        if (last && last.coef.equals(coef)) last.days += 1;
        else duringVacation.push({ date: day, days: 1, coef });
      }
    }
    amount = amount.plus(rate);
  }

  return { months, totalEarnings, totalDays, avgDaily, amount: round2(amount), method, afterPeriod, duringVacation };
}

// ---------------------------------------------------------------------------
// Больничные
// ---------------------------------------------------------------------------

export type InsuranceTenurePct = 60 | 80 | 100;

export interface SickLeaveInput {
  illnessStart: Date;
  sickDays: number;
  /** % среднего заработка по страховому стажу: до 5 лет — 60, 5–8 лет — 80, от 8 лет — 100. */
  tenurePct: InsuranceTenurePct;
  /** Выплаты, облагаемые взносами, у этого работодателя — по календарным годам. */
  earningsByYear: Map<number, Decimal>;
  /** Заработок у других работодателей по справкам — по годам. */
  otherEmployersByYear?: Map<number, Decimal>;
  /** Предельная база для начисления взносов — по годам. */
  baseLimitByYear: Map<number, Decimal>;
  /** МРОТ на начало года болезни. */
  mrot: Decimal;
  /** Годы расчётного периода; по умолчанию — два года перед годом болезни (замена — по заявлению). */
  calcYears?: [number, number];
  /** Районный коэффициент организации: минимум из МРОТ и ограничение при коротком стаже — с ним. */
  districtCoef?: Decimal;
  /** Страховой стаж меньше 6 месяцев: пособие за полный месяц не больше МРОТ (× районный коэффициент). */
  shortTenure?: boolean;
}

export interface SickLeaveYearRow {
  year: number;
  earnings: Decimal;
  otherEmployers: Decimal;
  limit: Decimal;
  counted: Decimal;
}

export interface SickLeaveResult {
  years: SickLeaveYearRow[];
  avgDailyActual: Decimal;
  minDaily: Decimal;
  avgDaily: Decimal;
  /** actual — по фактическому заработку; mrot — по минимуму из МРОТ. */
  basis: "actual" | "mrot";
  dailyBenefit: Decimal;
  total: Decimal;
  employerDays: number;
  employerAmount: Decimal;
  fundAmount: Decimal;
  districtCoef: Decimal;
  /** Ограничение по МРОТ за месяц при стаже меньше 6 месяцев — по месяцам болезни; пусто — не применялось. */
  monthlyCaps: Array<{ year: number; month: number; days: number; capDaily: Decimal; applied: boolean }>;
}

/**
 * Пособие по нетрудоспособности по ст. 14 Закона № 255-ФЗ: заработок за
 * два календарных года перед годом болезни (каждый год — не больше
 * предельной базы) делится на 730; средний дневной заработок не ниже
 * МРОТ × 24 / 730; пособие = средний × % по стажу × дни болезни.
 */
export function computeSickLeaveBenefit(input: SickLeaveInput): SickLeaveResult {
  if (!Number.isInteger(input.sickDays) || input.sickDays < 1) {
    throw new Error("Число дней болезни должно быть целым положительным");
  }
  const illnessYear = input.illnessStart.getUTCFullYear();
  const calcYears = input.calcYears ?? [illnessYear - 2, illnessYear - 1];
  const years = calcYears.map((year) => {
    const limit = input.baseLimitByYear.get(year);
    if (!limit) {
      throw new Error(`Не задана предельная база для взносов за ${year} год — добавьте её в справочнике «Параметры расчёта зарплаты»`);
    }
    const earnings = input.earningsByYear.get(year) ?? toDecimal(0);
    const otherEmployers = input.otherEmployersByYear?.get(year) ?? toDecimal(0);
    const total = earnings.plus(otherEmployers);
    return { year, earnings, otherEmployers, limit, counted: Decimal.min(total, limit) };
  });

  const avgDailyActual = round2(sumMoney(years.map((y) => y.counted)).dividedBy(SICK_LEAVE_DIVISOR));
  const districtCoef = input.districtCoef ?? new Decimal(1);
  const minDaily = round2(input.mrot.times(districtCoef).times(24).dividedBy(SICK_LEAVE_DIVISOR));
  const basis = avgDailyActual.greaterThanOrEqualTo(minDaily) ? "actual" : "mrot";
  const avgDaily = basis === "actual" ? avgDailyActual : minDaily;
  const dailyBenefit = round2(avgDaily.times(input.tenurePct).dividedBy(100));

  // Day by day: with a short tenure each day is capped at МРОТ × coefficient / days of its month.
  const monthlyCaps: SickLeaveResult["monthlyCaps"] = [];
  const dayAmounts: Decimal[] = [];
  const startDay = utcDay(input.illnessStart);
  for (let i = 0; i < input.sickDays; i++) {
    const day = new Date(startDay + i * DAY_MS);
    if (!input.shortTenure) {
      dayAmounts.push(dailyBenefit);
      continue;
    }
    const year = day.getUTCFullYear();
    const month = day.getUTCMonth() + 1;
    let row = monthlyCaps.find((c) => c.year === year && c.month === month);
    if (!row) {
      const capDaily = round2(input.mrot.times(districtCoef).dividedBy(daysInMonth(year, month)));
      row = { year, month, days: 0, capDaily, applied: dailyBenefit.greaterThan(capDaily) };
      monthlyCaps.push(row);
    }
    row.days += 1;
    dayAmounts.push(Decimal.min(dailyBenefit, row.capDaily));
  }
  const total = round2(sumMoney(dayAmounts));
  const employerDays = Math.min(EMPLOYER_PAID_SICK_DAYS, input.sickDays);
  const employerAmount = round2(sumMoney(dayAmounts.slice(0, employerDays)));

  return {
    years,
    avgDailyActual,
    minDaily,
    avgDaily,
    basis,
    dailyBenefit,
    total,
    employerDays,
    employerAmount,
    fundAmount: total.minus(employerAmount),
    districtCoef,
    monthlyCaps,
  };
}
