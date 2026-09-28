import Decimal from "decimal.js";

/**
 * Налог в прогнозе сценария: УСН «доходы», УСН «доходы минус расходы» или
 * налог на прибыль. Налог считается нарастающим итогом с начала
 * календарного года (в пределах горизонта прогноза): начисление месяца —
 * прирост налога с начала года. Уплата — авансовые платежи в месяце после
 * квартала (апрель, июль, октябрь), за год — в марте следующего года (ЕНП,
 * срок 28-го числа): к уплате налог с начала года по конец квартала минус
 * уже уплаченное за этот год; переплата в прогнозе не возвращается, а
 * уменьшает следующие платежи года.
 */
export type TaxRegime = "none" | "usn_income" | "usn_income_expense" | "profit";

export const TAX_REGIMES: TaxRegime[] = ["none", "usn_income", "usn_income_expense", "profit"];

export const TAX_REGIME_LABELS: Record<TaxRegime, string> = {
  none: "Не считать",
  usn_income: "УСН «доходы»",
  usn_income_expense: "УСН «доходы минус расходы»",
  profit: "Налог на прибыль (ОСН)",
};

export const DEFAULT_TAX_RATES: Record<TaxRegime, number> = {
  none: 0,
  usn_income: 6,
  usn_income_expense: 15,
  profit: 25,
};

/** Минимальный налог УСН «доходы минус расходы» — 1 % доходов за год. */
const USN_MIN_TAX_RATE = new Decimal("0.01");

export interface TaxMonthInput {
  year: number;
  month: number;
  /** Деньги от клиентов, полученные в месяце (УСН — кассовый метод). */
  income: Decimal;
  /** Оплаченные расходы месяца (для УСН «доходы минус расходы»). */
  expenses: Decimal;
  /** Прибыль до налога по методу начисления (для налога на прибыль). */
  profit: Decimal;
}

export interface TaxMonth {
  /** Начислено в месяце (может быть отрицательным, если убыток уменьшил налог с начала года). */
  accrued: Decimal;
  paid: Decimal;
  /** Налог к уплате на конец месяца. */
  payableEnd: Decimal;
}

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const zero = new Decimal(0);

export function taxRate(regime: TaxRegime, customPct: Decimal | number | string | null | undefined): Decimal {
  if (regime === "none") return zero;
  return customPct === null || customPct === undefined || customPct === "" ? new Decimal(DEFAULT_TAX_RATES[regime]) : new Decimal(customPct);
}

export function taxSchedule(regime: TaxRegime, ratePct: Decimal, months: TaxMonthInput[]): TaxMonth[] {
  if (regime === "none") return months.map(() => ({ accrued: zero, paid: zero, payableEnd: zero }));
  const rate = ratePct.dividedBy(100);
  const year = new Map<number, { income: Decimal; base: Decimal; tax: Decimal; paid: Decimal; byQuarter: Decimal[] }>();
  const yearOf = (y: number) => {
    let entry = year.get(y);
    if (!entry) year.set(y, (entry = { income: zero, base: zero, tax: zero, paid: zero, byQuarter: [] }));
    return entry;
  };

  let payable = zero;
  return months.map((m) => {
    // Payment first: it settles the previous quarter (or year), whose figures are already known.
    let paid = zero;
    if (m.month === 4 || m.month === 7 || m.month === 10 || m.month === 3) {
      const settledYear = m.month === 3 ? m.year - 1 : m.year;
      const quarter = m.month === 3 ? 4 : (m.month - 1) / 3;
      const y = year.get(settledYear);
      const due = y?.byQuarter[quarter - 1];
      if (y && due) {
        paid = Decimal.max(0, due.minus(y.paid));
        y.paid = y.paid.plus(paid);
      }
    }

    const y = yearOf(m.year);
    y.income = y.income.plus(m.income);
    y.base = y.base.plus(regime === "usn_income" ? m.income : regime === "usn_income_expense" ? m.income.minus(m.expenses) : m.profit);
    let cumulative = round2(Decimal.max(0, y.base).times(rate));
    if (regime === "usn_income_expense" && m.month === 12) cumulative = Decimal.max(cumulative, round2(y.income.times(USN_MIN_TAX_RATE)));
    const accrued = cumulative.minus(y.tax);
    y.tax = cumulative;
    if (m.month % 3 === 0) y.byQuarter[m.month / 3 - 1] = cumulative;

    payable = payable.plus(accrued).minus(paid);
    return { accrued, paid, payableEnd: payable };
  });
}
