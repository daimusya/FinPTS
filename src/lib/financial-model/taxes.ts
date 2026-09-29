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

/**
 * Факт с 1 января до начала прогноза (год первого месяца прогноза): налог,
 * порог взносов и минимальный налог считаются нарастающим итогом за весь
 * год. Налог за эти месяцы считается уплаченным вне прогноза — в прогнозе
 * начисляется и платится только прирост.
 */
export interface YearOpening extends Omit<TaxMonthInput, "month"> {
  /** Сколько месяцев года прошло до начала прогноза (1–11). */
  months: number;
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

type TaxYear = {
  income: Decimal;
  base: Decimal;
  tax: Decimal;
  paid: Decimal;
  byMonth: Decimal[];
  contributions: Decimal;
  reduction: Decimal;
  employees: boolean;
};

export function taxSchedule(regime: TaxRegime, ratePct: TaxRateInput, months: TaxMonthInput[], opening?: YearOpening | null): TaxMonth[] {
  if (regime === "none") return months.map(() => ({ accrued: zero, paid: zero, payableEnd: zero, reduction: zero }));
  const rateOf = (y: number) => (typeof ratePct === "function" ? ratePct(y) : ratePct).dividedBy(100);
  const year = new Map<number, TaxYear>();
  const yearOf = (y: number) => {
    let entry = year.get(y);
    if (!entry) {
      entry = { income: zero, base: zero, tax: zero, paid: zero, byMonth: [], contributions: zero, reduction: zero, employees: false };
      year.set(y, entry);
    }
    return entry;
  };
  const incomeOnly = regime === "usn_income" || regime === "ausn_income";

  /** Adds a period to the year and returns the tax since the start of the year and the growth of the reduction. */
  const accumulate = (y: TaxYear, m: Omit<TaxMonthInput, "month">, month: number) => {
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
    if (minRate && month === 12) cumulative = Decimal.max(cumulative, round2(y.income.times(minRate)));
    return { cumulative, reduction };
  };

  if (opening && months.length > 0 && opening.year === months[0].year) {
    const y = yearOf(opening.year);
    const { cumulative } = accumulate(y, opening, opening.months);
    // The months before the forecast are settled outside it.
    y.tax = cumulative;
    y.paid = cumulative;
    for (let k = 1; k <= opening.months; k++) y.byMonth[k] = cumulative;
  }

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
    const { cumulative, reduction } = accumulate(y, m, m.month);
    const accrued = cumulative.minus(y.tax);
    y.tax = cumulative;
    y.byMonth[m.month] = cumulative;

    payable = payable.plus(accrued).minus(paid);
    return { accrued, paid, payableEnd: payable, reduction };
  });
}

// ---------------------------------------------------------------------------
// Страховые взносы ИП за себя
// ---------------------------------------------------------------------------

/**
 * Взносы ИП за себя (прогноз «как у организации» для ИП): фиксированные —
 * сумма года пропорционально дням деятельности (полные месяцы — по 1/12,
 * месяц регистрации или прекращения — по календарным дням), уплата в
 * декабре; с дохода свыше порога — ставка × (доход с начала года − порог),
 * не больше максимума года, уплата в июле следующего года. При прекращении
 * деятельности всё за этот год — в течение 15 дней после даты прекращения.
 * Доход — как у налога: при УСН «доходы» — полученные деньги, иначе
 * полученное минус оплаченные расходы.
 */
export interface IpContributionParams {
  base: "income" | "income_minus_expenses";
  forYear: (year: number) => {
    fixed: Decimal | null;
    income: { ratePct: Decimal; threshold: Decimal; max: Decimal | null } | null;
  };
  /** Дата регистрации ИП (null — зарегистрирован раньше). */
  activeFrom?: Date | null;
  /** Дата прекращения деятельности (null — работает). */
  activeTo?: Date | null;
}

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Доля месяца, в которую ИП вёл деятельность (0–1). */
export function activeShare(year: number, month: number, from?: Date | null, to?: Date | null): Decimal {
  const first = Date.UTC(year, month - 1, 1);
  const last = Date.UTC(year, month, 0);
  const days = (last - first) / DAY_MS + 1;
  const start = Math.max(first, from ? utcDay(from) : first);
  const end = Math.min(last, to ? utcDay(to) : last);
  return end < start ? zero : new Decimal((end - start) / DAY_MS + 1).dividedBy(days);
}

/** Сколько двенадцатых года прошло к концу месяца month (с учётом дат регистрации и прекращения). */
function yearShareThrough(params: IpContributionParams, year: number, month: number): Decimal {
  let share = zero;
  for (let k = 1; k <= month; k++) share = share.plus(activeShare(year, k, params.activeFrom, params.activeTo));
  return share;
}

/** Взносы за себя за месяцы года до начала прогноза: не начисляются в прогнозе, но уплачиваются по срокам. */
export function ipContributionOpening(params: IpContributionParams, opening: YearOpening): { fixed: Decimal; income: Decimal; base: Decimal } {
  const settings = params.forYear(opening.year);
  const fixed = settings.fixed ? round2(settings.fixed.times(yearShareThrough(params, opening.year, opening.months)).dividedBy(12)) : zero;
  const base = params.base === "income" ? opening.income : opening.income.minus(opening.expenses);
  return { fixed, income: incomeContribution(settings.income, base), base };
}

function incomeContribution(settings: { ratePct: Decimal; threshold: Decimal; max: Decimal | null } | null, base: Decimal): Decimal {
  if (!settings) return zero;
  const amount = round2(Decimal.max(0, base.minus(settings.threshold)).times(settings.ratePct).dividedBy(100));
  return settings.max ? Decimal.min(amount, settings.max) : amount;
}

export function ipContributionSchedule(params: IpContributionParams, months: TaxMonthInput[], opening?: YearOpening | null): TaxMonth[] {
  const years = new Map<number, { base: Decimal; incomeCum: Decimal; fixedCum: Decimal; fixedPaid: boolean; incomePaid: boolean }>();
  const yearOf = (y: number) => {
    let entry = years.get(y);
    if (!entry) years.set(y, (entry = { base: zero, incomeCum: zero, fixedCum: zero, fixedPaid: false, incomePaid: false }));
    return entry;
  };
  // Contributions for the months before the forecast are not accrued in it, but they are still owed.
  let payable = zero;
  if (opening && months.length > 0 && opening.year === months[0].year) {
    const before = ipContributionOpening(params, opening);
    const y = yearOf(opening.year);
    y.base = before.base;
    y.incomeCum = before.income;
    y.fixedCum = before.fixed;
    payable = before.fixed.plus(before.income);
  }
  // On closure everything for that year is due within 15 days.
  const closurePay = params.activeTo ? new Date(utcDay(params.activeTo) + 15 * DAY_MS) : null;
  const closureIndex = closurePay ? closurePay.getUTCFullYear() * 12 + closurePay.getUTCMonth() : null;
  const closureYear = params.activeTo?.getUTCFullYear() ?? null;
  const closedAfter = params.activeTo ? utcDay(params.activeTo) : Infinity;

  return months.map((m) => {
    const y = yearOf(m.year);
    const settings = params.forYear(m.year);

    // Fixed: the share of the year worked; rounding the running total keeps the year's sum exact.
    let fixed = zero;
    if (settings.fixed) {
      const cum = round2(settings.fixed.times(yearShareThrough(params, m.year, m.month)).dividedBy(12));
      fixed = cum.minus(y.fixedCum);
      y.fixedCum = cum;
    }

    // On income above the threshold: since the start of the year, up to the annual maximum; nothing after closure.
    if (Date.UTC(m.year, m.month - 1, 1) <= closedAfter) y.base = y.base.plus(params.base === "income" ? m.income : m.income.minus(m.expenses));
    const incomeCum = incomeContribution(settings.income, y.base);
    const accrued = fixed.plus(incomeCum.minus(y.incomeCum));
    y.incomeCum = incomeCum;

    let paid = zero;
    const index = m.year * 12 + m.month - 1;
    for (const [year, state] of years) {
      const closing = closureYear === year && closureIndex !== null;
      const fixedDue = closing ? index === closureIndex : year === m.year && m.month === 12;
      const incomeDue = closing ? index === closureIndex : year === m.year - 1 && m.month === 7;
      if (fixedDue && !state.fixedPaid) {
        paid = paid.plus(state.fixedCum);
        state.fixedPaid = true;
      }
      if (incomeDue && !state.incomePaid) {
        paid = paid.plus(state.incomeCum);
        state.incomePaid = true;
      }
    }

    payable = payable.plus(accrued).minus(paid);
    return { accrued, paid, payableEnd: payable, reduction: zero };
  });
}

// ---------------------------------------------------------------------------
// НДС
// ---------------------------------------------------------------------------

/**
 * НДС в прогнозе. Выручка и расходы прогноза — без НДС: клиенты платят
 * выручку плюс НДС. При общих ставках (22 %, 10 %) НДС поставщиков по
 * переменным расходам и комиссии посредников принимается к вычету, их оплата
 * тоже идёт с НДС; при специальных ставках УСН (5 %, 7 %) вычетов нет.
 * НДС за квартал = с выручки − к вычету, уплата тремя равными частями в три
 * следующих месяца (28-го); вычет больше начисленного переносится на
 * следующий квартал. На прибыль НДС не влияет, только на деньги.
 */
export interface VatParams {
  /** Ставка НДС, % на год (null — НДС нет). */
  rateForYear: (year: number) => Decimal | null;
  /** НДС по документам до начала прогноза: прошлый квартал и месяцы текущего квартала до прогноза. */
  opening?: VatOpening | null;
  /** УСН: освобождение от НДС при доходе до лимита (доход прошлого года по факту). */
  usnExemption?: { previousYearIncome: Decimal } | null;
}

/** НДС из проведённых документов начисления («в т.ч. НДС»): исходящий — по доходным, входящий — по расходным. */
export interface VatOpening {
  previousQuarter: { output: Decimal; input: Decimal };
  currentQuarter: { output: Decimal; input: Decimal };
}

export interface VatMonthInput {
  year: number;
  month: number;
  /** Выручка месяца (без НДС) — база НДС к начислению. */
  revenue: Decimal;
  /** Расходы с входящим НДС (без НДС): переменные расходы и комиссия. */
  purchases: Decimal;
  /** Поступления от клиентов по выручке прогноза (без НДС). */
  collections: Decimal;
  /** Оплата поставщикам (без НДС). */
  supplierPayments: Decimal;
  /** Месяц освобождён от НДС (УСН при доходе до лимита). */
  exempt?: boolean;
}

export interface VatMonth {
  /** НДС, полученный от клиентов сверх выручки. */
  received: Decimal;
  /** НДС, уплаченный поставщикам сверх расходов (при вычетах). */
  paidToSuppliers: Decimal;
  /** Начислено к уплате в бюджет: с выручки минус вычет. */
  accrued: Decimal;
  /** Уплачено в бюджет. */
  paid: Decimal;
  payableEnd: Decimal;
}

/** Специальные ставки НДС на УСН — без вычетов. */
export const VAT_NO_DEDUCTION_RATES = new Set(["5", "7"]);

export function vatDeductible(ratePct: Decimal): boolean {
  return !VAT_NO_DEDUCTION_RATES.has(ratePct.toString());
}

export function vatSchedule(params: VatParams, months: VatMonthInput[]): VatMonth[] {
  const quarters = new Map<number, Decimal>();
  let carry = zero;
  let payable = zero;
  // VAT before the forecast (from the documents): the rest of the previous quarter's thirds and the start of this quarter.
  if (params.opening && months.length > 0) {
    const startIndex = months[0].year * 12 + months[0].month - 1;
    const quarter = Math.floor(startIndex / 3);
    const net = (part: { output: Decimal; input: Decimal }, year: number) => {
      const rate = params.rateForYear(year);
      return part.output.minus(rate && vatDeductible(rate) ? part.input : zero);
    };
    const previous = net(params.opening.previousQuarter, Math.floor((quarter - 1) * 3 / 12));
    if (previous.greaterThan(0)) {
      quarters.set(quarter - 1, previous);
      payable = previous.minus(round2(previous.dividedBy(3)).times(startIndex % 3));
    } else {
      carry = previous;
    }
    const current = net(params.opening.currentQuarter, months[0].year);
    quarters.set(quarter, current);
    payable = payable.plus(current);
  }
  return months.map((m) => {
    const rate = m.exempt ? null : params.rateForYear(m.year);
    const r = rate ? rate.dividedBy(100) : zero;
    const deductible = rate ? vatDeductible(rate) : false;
    const received = round2(m.collections.times(r));
    const paidToSuppliers = deductible ? round2(m.supplierPayments.times(r)) : zero;
    const accrued = round2(m.revenue.times(r)).minus(deductible ? round2(m.purchases.times(r)) : zero);

    // Thirds of the previous quarter's VAT in each of the three months after it.
    const index = m.year * 12 + m.month - 1;
    const quarterIndex = Math.floor(index / 3);
    const monthInQuarter = index % 3;
    const previous = quarters.get(quarterIndex - 1);
    let paid = zero;
    if (previous && previous.greaterThan(0)) {
      const third = round2(previous.dividedBy(3));
      paid = monthInQuarter === 2 ? previous.minus(third.times(2)) : third;
    }
    // A quarter's VAT is known at its end; a deduction above the charge moves to the next quarter.
    const sum = (quarters.get(quarterIndex) ?? zero).plus(accrued);
    quarters.set(quarterIndex, sum);
    if (monthInQuarter === 2) {
      const total = sum.plus(carry);
      carry = Decimal.min(0, total);
      quarters.set(quarterIndex, Decimal.max(0, total));
    }

    payable = payable.plus(accrued).minus(paid);
    return { received, paidToSuppliers, accrued, paid, payableEnd: payable };
  });
}

/**
 * Лимит дохода для освобождения от НДС на УСН (ст. 145 НК РФ в редакции с
 * 2025 года): 60 млн ₽ в 2025, 20 млн в 2026, 15 млн в 2027, 10 млн с 2028.
 * До 2025 года УСН НДС не платила — null (освобождена всегда).
 */
export function usnVatLimit(year: number): Decimal | null {
  if (year < 2025) return null;
  return new Decimal(year === 2025 ? 60_000_000 : year === 2026 ? 20_000_000 : year === 2027 ? 15_000_000 : 10_000_000);
}

/**
 * Какие месяцы прогноза освобождены от НДС на УСН: если доход прошлого года
 * не больше лимита текущего, НДС нет — пока доход с начала года не превысит
 * лимит; со следующего месяца после превышения и до конца года НДС есть.
 * Доход — полученные деньги (как у налога УСН); прошлый год — по факту или
 * по прогнозу, если прогноз его охватывает; факт с начала года (opening)
 * входит в доход года начала прогноза.
 */
export function usnVatExemptMonths(
  months: Array<{ year: number; month: number; income: Decimal }>,
  previousYearIncome: Decimal,
  opening: { year: number; income: Decimal } | null,
): boolean[] {
  const incomeByYear = new Map<number, Decimal>();
  if (opening) incomeByYear.set(opening.year, opening.income);
  const firstYear = months[0]?.year;
  if (firstYear !== undefined) incomeByYear.set(firstYear - 1, previousYearIncome);
  return months.map((m) => {
    const limit = usnVatLimit(m.year);
    const previousYear = incomeByYear.get(m.year - 1) ?? zero;
    const before = incomeByYear.get(m.year) ?? zero; // income since 1 January before this month
    incomeByYear.set(m.year, before.plus(m.income));
    // Income only grows within a year, so once above the limit the exemption stays lost until December.
    return limit === null || (previousYear.lessThanOrEqualTo(limit) && before.lessThanOrEqualTo(limit));
  });
}
