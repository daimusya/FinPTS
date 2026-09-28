import Decimal from "decimal.js";

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const DAYS_PER_MONTH = 30;

/**
 * Распределяет суммы по месяцам со сдвигом на отсрочку оплаты. amounts[i] —
 * сумма месяца i (выручка или расходы), lagDays[i] — отсрочка в днях для неё.
 * Отсрочка в месяцах = дни / 30; дробная часть делит сумму между двумя
 * соседними месяцами: при 45 днях половина приходит через месяц, половина —
 * через два. Что не успевает прийти до конца горизонта, остаётся в `beyond`
 * (дебиторка или кредиторка на конец прогноза).
 */
export function shiftByLag(amounts: Decimal[], lagDays: number[]): { byMonth: Decimal[]; beyond: Decimal } {
  const byMonth = amounts.map(() => new Decimal(0));
  let beyond = new Decimal(0);
  amounts.forEach((amount, i) => {
    const lagMonths = Math.max(0, lagDays[i] ?? 0) / DAYS_PER_MONTH;
    const whole = Math.floor(lagMonths);
    const fraction = new Decimal(lagMonths - whole);
    const parts: Array<[number, Decimal]> = [
      [i + whole, amount.times(new Decimal(1).minus(fraction))],
      [i + whole + 1, amount.times(fraction)],
    ];
    for (const [month, part] of parts) {
      if (part.isZero()) continue;
      if (month < byMonth.length) byMonth[month] = byMonth[month].plus(part);
      else beyond = beyond.plus(part);
    }
  });
  return { byMonth, beyond };
}

export type LoanRepayment = "annuity" | "linear" | "bullet";

export const LOAN_REPAYMENT_LABELS: Record<LoanRepayment, string> = {
  annuity: "Аннуитет (равные платежи)",
  linear: "Равными долями основного долга",
  bullet: "Проценты ежемесячно, долг в конце срока",
};

export interface LoanInput {
  id: string;
  name: string;
  amount: Decimal;
  /** Месяц получения денег: год × 12 + (месяц − 1). */
  startIndex: number;
  annualRatePct: Decimal;
  termMonths: number;
  repayment: LoanRepayment;
  /** Льготный период: первые N месяцев платежей — только проценты. */
  graceMonths?: number;
  /** Досрочное погашение части долга в месяц index (вместе с плановым платежом). */
  prepayment?: { index: number; amount: Decimal } | null;
}

export interface LoanMonth {
  drawdown: Decimal;
  interest: Decimal;
  principal: Decimal;
  /** Остаток долга на конец месяца. */
  balance: Decimal;
}

/**
 * График кредита по месяцам (ключ — индекс месяца год × 12 + месяц − 1).
 * Деньги приходят в месяц получения, платежи начинаются со следующего:
 * проценты = остаток × ставка / 12; основной долг — по типу погашения.
 * В льготный период платятся только проценты, долг гасится за оставшиеся
 * месяцы срока. Досрочное погашение уменьшает долг сверх планового платежа;
 * срок сохраняется, платёж дальше пересчитывается на новый остаток.
 * Суммы округляются до копеек, последний платёж закрывает долг ровно в ноль.
 */
export function loanSchedule(loan: LoanInput): Map<number, LoanMonth> {
  const schedule = new Map<number, LoanMonth>();
  const r = loan.annualRatePct.dividedBy(100).dividedBy(12);
  const n = loan.termMonths;
  const grace = Math.min(Math.max(0, loan.graceMonths ?? 0), n - 1);
  schedule.set(loan.startIndex, { drawdown: loan.amount, interest: new Decimal(0), principal: new Decimal(0), balance: loan.amount });

  // Planned principal part (linear) or payment (annuity) for the remaining months, recalculated after grace and prepayment.
  const plan = (balance: Decimal, remaining: number) => {
    if (loan.repayment === "linear") return round2(balance.dividedBy(remaining));
    if (r.isZero()) return round2(balance.dividedBy(remaining));
    return round2(balance.times(r).dividedBy(new Decimal(1).minus(new Decimal(1).plus(r).pow(-remaining))));
  };

  let balance = loan.amount;
  let planned = plan(balance, n - grace);
  for (let k = 1; k <= n; k += 1) {
    const index = loan.startIndex + k;
    const interest = round2(balance.times(r));
    let principal: Decimal;
    if (k === n) principal = balance;
    else if (k <= grace || loan.repayment === "bullet") principal = new Decimal(0);
    else if (loan.repayment === "annuity") principal = r.isZero() ? planned : planned.minus(interest);
    else principal = planned;
    principal = Decimal.max(0, Decimal.min(principal, balance));
    balance = balance.minus(principal);
    let recalc = k === grace;
    if (loan.prepayment && loan.prepayment.index === index && balance.greaterThan(0)) {
      const extra = Decimal.min(loan.prepayment.amount, balance);
      principal = principal.plus(extra);
      balance = balance.minus(extra);
      recalc = true;
    }
    if (recalc && k < n) planned = plan(balance, n - Math.max(k, grace));
    schedule.set(index, { drawdown: new Decimal(0), interest, principal, balance });
    if (balance.isZero()) break;
  }
  return schedule;
}
