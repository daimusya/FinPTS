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
}

export interface VacationMonthRow {
  year: number;
  month: number;
  calendarDays: number;
  employedDays: number;
  excludedDays: number;
  countedDays: Decimal;
  earnings: Decimal;
}

export interface VacationResult {
  months: VacationMonthRow[];
  totalEarnings: Decimal;
  totalDays: Decimal;
  avgDaily: Decimal;
  amount: Decimal;
  /** average — по фактическому заработку; salary — по окладу (п. 8 Положения № 922). */
  method: "average" | "salary";
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

    months.push({
      year,
      month,
      calendarDays,
      employedDays,
      excludedDays,
      countedDays,
      earnings: input.earningsByMonth.get(monthKey(year, month)) ?? toDecimal(0),
    });
  }

  const totalEarnings = sumMoney(months.map((m) => m.earnings));
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

  return { months, totalEarnings, totalDays, avgDaily, amount: round2(avgDaily.times(input.vacationDays)), method };
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
  const years = [illnessYear - 2, illnessYear - 1].map((year) => {
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
  const minDaily = round2(input.mrot.times(24).dividedBy(SICK_LEAVE_DIVISOR));
  const basis = avgDailyActual.greaterThanOrEqualTo(minDaily) ? "actual" : "mrot";
  const avgDaily = basis === "actual" ? avgDailyActual : minDaily;
  const dailyBenefit = round2(avgDaily.times(input.tenurePct).dividedBy(100));
  const total = round2(dailyBenefit.times(input.sickDays));
  const employerDays = Math.min(EMPLOYER_PAID_SICK_DAYS, input.sickDays);
  const employerAmount = round2(dailyBenefit.times(employerDays));

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
  };
}
