import Decimal from "decimal.js";

/**
 * Налог в прогнозе сценария: УСН, АУСН, ЕСХН или налог на прибыль. Налог
 * считается нарастающим итогом с начала календарного года (в пределах
 * горизонта прогноза): начисление месяца — прирост налога с начала года.
 * Уплата (ЕНП, 28-го; АУСН — 25-го): УСН и налог на прибыль — в месяце после
 * квартала (апрель, июль, октябрь), за год — в марте следующего года; ЕСХН —
 * за полугодие в июле и за год в марте; АУСН — каждый месяц за предыдущий.
 * К уплате — налог с начала года по конец расчётного периода минус уже
 * уплаченное за этот год; переплата в прогнозе не возвращается, а уменьшает
 * следующие платежи года.
 */
export type TaxRegime = "none" | "usn_income" | "usn_income_expense" | "ausn_income" | "ausn_income_expense" | "eshn" | "profit";

export const TAX_REGIMES: TaxRegime[] = ["none", "usn_income", "usn_income_expense", "ausn_income", "ausn_income_expense", "eshn", "profit"];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  none: "Не считать",
  usn_income: "УСН «доходы»",
  usn_income_expense: "УСН «доходы минус расходы»",
  ausn_income: "АУСН «доходы»",
  ausn_income_expense: "АУСН «доходы минус расходы»",
  eshn: "ЕСХН",
  profit: "Налог на прибыль (ОСН)",
};

export const DEFAULT_TAX_RATES: Record<TaxRegime, number> = {
  none: 0,
  usn_income: 6,
  usn_income_expense: 15,
  ausn_income: 8,
  ausn_income_expense: 20,
  eshn: 6,
  profit: 25,
};

/** Минимальный налог за год, доля доходов: УСН «доходы минус расходы» — 1 %, АУСН — 3 %. */
const MIN_TAX_RATE: Partial<Record<TaxRegime, Decimal>> = {
  usn_income_expense: new Decimal("0.01"),
  ausn_income_expense: new Decimal("0.03"),
};

/** Какой период закрывает уплата в месяце month: год и последний месяц периода — или null, если уплаты нет. */
function settles(regime: TaxRegime, year: number, month: number): { year: number; through: number } | null {
  if (regime === "ausn_income" || regime === "ausn_income_expense") return month === 1 ? { year: year - 1, through: 12 } : { year, through: month - 1 };
  if (month === 3) return { year: year - 1, through: 12 };
  if (regime === "eshn") return month === 7 ? { year, through: 6 } : null;
  return month === 4 || month === 7 || month === 10 ? { year, through: month - 1 } : null;
}

export interface TaxMonthInput {
  year: number;
  month: number;
  /** Деньги от клиентов, полученные в месяце (УСН — кассовый метод). */
  income: Decimal;
  /** Оплаченные расходы месяца (для УСН «доходы минус расходы»). */
  expenses: Decimal;
  /** Прибыль до налога по методу начисления (для налога на прибыль). */
  profit: Decimal;
  /**
   * УСН «доходы»: страховые взносы месяца, на которые уменьшается налог
   * (взносы ИП за себя и, при сотрудниках, взносы за сотрудников).
   */
  deductibleContributions?: Decimal;
  /** Есть сотрудники в этом месяце: уменьшение — не больше 50 % налога. */
  hasEmployees?: boolean;
}

export interface TaxMonth {
  /** Начислено в месяце (может быть отрицательным, если убыток уменьшил налог с начала года). */
  accrued: Decimal;
  paid: Decimal;
  /** Налог к уплате на конец месяца. */
  payableEnd: Decimal;
  /** На сколько в этом месяце выросло уменьшение налога на страховые взносы (с начала года). */
  reduction: Decimal;
}

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const zero = new Decimal(0);

export function taxRate(regime: TaxRegime, customPct: Decimal | number | string | null | undefined): Decimal {
  if (regime === "none") return zero;
  return customPct === null || customPct === undefined || customPct === "" ? new Decimal(DEFAULT_TAX_RATES[regime]) : new Decimal(customPct);
}

/** Ставка, % — одна на весь прогноз или своя на каждый год (ставки меняются с начала года). */
export type TaxRateInput = Decimal | ((year: number) => Decimal);

export function taxSchedule(regime: TaxRegime, ratePct: TaxRateInput, months: TaxMonthInput[]): TaxMonth[] {
  if (regime === "none") return months.map(() => ({ accrued: zero, paid: zero, payableEnd: zero, reduction: zero }));
  const rateOf = (y: number) => (typeof ratePct === "function" ? ratePct(y) : ratePct).dividedBy(100);
  type YearState = {
    income: Decimal;
    base: Decimal;
    tax: Decimal;
    paid: Decimal;
    byMonth: Decimal[];
    contributions: Decimal;
    reduction: Decimal;
    employees: boolean;
  };
  const year = new Map<number, YearState>();
  const yearOf = (y: number) => {
    let entry = year.get(y);
    if (!entry) {
      entry = { income: zero, base: zero, tax: zero, paid: zero, byMonth: [], contributions: zero, reduction: zero, employees: false };
      year.set(y, entry);
    }
    return entry;
  };
  const incomeOnly = regime === "usn_income" || regime === "ausn_income";

  let payable = zero;
  return months.map((m) => {
    // Payment first: it settles an earlier period, whose figures are already known.
    let paid = zero;
    const settled = settles(regime, m.year, m.month);
    const sy = settled ? year.get(settled.year) : undefined;
    const due = settled && sy ? sy.byMonth[settled.through] : undefined;
    if (sy && due) {
      paid = Decimal.max(0, due.minus(sy.paid));
      sy.paid = sy.paid.plus(paid);
    }

    const y = yearOf(m.year);
    y.income = y.income.plus(m.income);
    y.base = y.base.plus(incomeOnly ? m.income : regime === "profit" ? m.profit : m.income.minus(m.expenses));
    let cumulative = round2(Decimal.max(0, y.base).times(rateOf(m.year)));
    // USN on income is reduced by the insurance contributions since the start of the year: in full
    // without employees, by no more than half of the tax once there have been employees this year.
    let reduction = zero;
    if (regime === "usn_income") {
      y.contributions = y.contributions.plus(m.deductibleContributions ?? zero);
      y.employees = y.employees || Boolean(m.hasEmployees);
      const limit = y.employees ? round2(cumulative.dividedBy(2)) : cumulative;
      const total = Decimal.min(y.contributions, limit);
      reduction = total.minus(y.reduction);
      y.reduction = total;
      cumulative = cumulative.minus(total);
    }
    const minRate = MIN_TAX_RATE[regime];
    if (minRate && m.month === 12) cumulative = Decimal.max(cumulative, round2(y.income.times(minRate)));
    const accrued = cumulative.minus(y.tax);
    y.tax = cumulative;
    y.byMonth[m.month] = cumulative;

    payable = payable.plus(accrued).minus(paid);
    return { accrued, paid, payableEnd: payable, reduction };
  });
}

/**
 * Взносы ИП за себя (только в прогнозе «как у организации» для ИП):
 * фиксированные — сумма года равными долями по месяцам, уплата в декабре
 * (срок — 28 декабря); с дохода свыше порога — ставка × (доход с начала
 * года − порог), не больше максимума года, нарастающим итогом, уплата в
 * июле следующего года (срок — 1 июля). Доход — как у налога: при УСН
 * «доходы» — полученные деньги, иначе полученное минус оплаченные расходы.
 * Уменьшение налога на взносы не учитывается.
 */
export interface IpContributionParams {
  base: "income" | "income_minus_expenses";
  forYear: (year: number) => {
    fixed: Decimal | null;
    income: { ratePct: Decimal; threshold: Decimal; max: Decimal | null } | null;
  };
}

export function ipContributionSchedule(params: IpContributionParams, months: TaxMonthInput[]): TaxMonth[] {
  const years = new Map<number, { base: Decimal; incomeCum: Decimal; fixedAccrued: Decimal }>();
  let payable = zero;
  return months.map((m) => {
    const y = years.get(m.year) ?? { base: zero, incomeCum: zero, fixedAccrued: zero };
    years.set(m.year, y);
    const settings = params.forYear(m.year);

    // Fixed: the amount of the year spread evenly, so twelve months add up to it exactly.
    const fixed = settings.fixed
      ? round2(settings.fixed.times(m.month).dividedBy(12)).minus(round2(settings.fixed.times(m.month - 1).dividedBy(12)))
      : zero;
    y.fixedAccrued = y.fixedAccrued.plus(fixed);

    // On income above the threshold: since the start of the year, up to the annual maximum.
    y.base = y.base.plus(params.base === "income" ? m.income : m.income.minus(m.expenses));
    let incomeCum = zero;
    if (settings.income) {
      incomeCum = round2(Decimal.max(0, y.base.minus(settings.income.threshold)).times(settings.income.ratePct).dividedBy(100));
      if (settings.income.max) incomeCum = Decimal.min(incomeCum, settings.income.max);
    }
    const accrued = fixed.plus(incomeCum.minus(y.incomeCum));
    y.incomeCum = incomeCum;

    // Fixed ones are paid for the year in December, the ones on income — in July of the next year.
    let paid = m.month === 12 ? y.fixedAccrued : zero;
    const previous = years.get(m.year - 1);
    if (m.month === 7 && previous) paid = paid.plus(previous.incomeCum);

    payable = payable.plus(accrued).minus(paid);
    return { accrued, paid, payableEnd: payable, reduction: zero };
  });
}
