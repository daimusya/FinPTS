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
 * Суммы округляются до копеек, последний платёж закрывает долг ровно в ноль.
 */
export function loanSchedule(loan: LoanInput): Map<number, LoanMonth> {
  const schedule = new Map<number, LoanMonth>();
  const r = loan.annualRatePct.dividedBy(100).dividedBy(12);
  const n = loan.termMonths;
  schedule.set(loan.startIndex, { drawdown: loan.amount, interest: new Decimal(0), principal: new Decimal(0), balance: loan.amount });

  const annuity = r.isZero()
    ? loan.amount.dividedBy(n)
    : loan.amount.times(r).dividedBy(new Decimal(1).minus(new Decimal(1).plus(r).pow(-n)));

  let balance = loan.amount;
  for (let k = 1; k <= n; k += 1) {
    const interest = round2(balance.times(r));
    let principal: Decimal;
    if (k === n) principal = balance;
    else if (loan.repayment === "annuity") principal = round2(annuity).minus(interest);
    else if (loan.repayment === "linear") principal = round2(loan.amount.dividedBy(n));
    else principal = new Decimal(0);
    principal = Decimal.max(0, Decimal.min(principal, balance));
    balance = balance.minus(principal);
    schedule.set(loan.startIndex + k, { drawdown: new Decimal(0), interest, principal, balance });
  }
  return schedule;
}
