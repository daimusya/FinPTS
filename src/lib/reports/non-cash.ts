import Decimal from "decimal.js";
import { toDecimal } from "@/lib/money";

/**
 * Начисления без документов и без движения денег: амортизация основных
 * средств и проценты по займам. Считаются по реестрам (справочники
 * «Основные средства» и «Займы и кредиты») помесячно; начисление месяца
 * относится к его последнему дню — так ОПиУ за месяц и баланс на конец месяца
 * согласованы, а баланс на середину месяца ещё не включает текущий месяц.
 */
export interface MonthCharge {
  year: number;
  month: number;
  amount: Decimal;
}

const DAY_MS = 86_400_000;
const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
export const monthEnd = (year: number, month: number) => Date.UTC(year, month, 0);

/** Начисления, у которых последний день месяца попадает в [from, to]. */
export function chargesIn(charges: MonthCharge[], from: Date | null, to: Date): Decimal {
  const lo = from ? utcDay(from) : -Infinity;
  const hi = utcDay(to);
  return charges.reduce((sum, c) => {
    const end = monthEnd(c.year, c.month);
    return end >= lo && end <= hi ? sum.plus(c.amount) : sum;
  }, new Decimal(0));
}

// ---------------------------------------------------------------------------
// Амортизация
// ---------------------------------------------------------------------------

export interface FixedAssetInput {
  cost: Decimal | number | string;
  commissioningDate: Date;
  usefulLifeMonths: number;
  /** Выбытие: амортизация начисляется по месяц выбытия включительно. */
  disposalDate?: Date | null;
}

/**
 * Линейная амортизация: стоимость / срок полезного использования в месяцах,
 * с месяца, следующего за вводом в эксплуатацию; последний месяц добирает
 * копейки округления, чтобы за срок списалась ровно стоимость.
 */
export function depreciationSchedule(asset: FixedAssetInput): MonthCharge[] {
  const cost = toDecimal(asset.cost);
  const life = asset.usefulLifeMonths;
  if (!Number.isInteger(life) || life < 1 || cost.lessThanOrEqualTo(0)) return [];
  const monthly = round2(cost.dividedBy(life));
  const startIndex = asset.commissioningDate.getUTCFullYear() * 12 + asset.commissioningDate.getUTCMonth() + 1;
  const stopIndex = asset.disposalDate ? asset.disposalDate.getUTCFullYear() * 12 + asset.disposalDate.getUTCMonth() : Infinity;
  const charges: MonthCharge[] = [];
  let charged = new Decimal(0);
  for (let i = 0; i < life; i++) {
    const index = startIndex + i;
    if (index > stopIndex) break;
    const amount = i === life - 1 ? cost.minus(charged) : monthly;
    charged = charged.plus(amount);
    charges.push({ year: Math.floor(index / 12), month: (index % 12) + 1, amount });
  }
  return charges;
}

// ---------------------------------------------------------------------------
// Проценты по займам
// ---------------------------------------------------------------------------

export interface DebtEvent {
  date: Date;
  /** Изменение долга: получение займа — плюс, погашение — минус. */
  delta: Decimal;
}

export interface LoanInterestInput {
  annualRatePct: Decimal | number | string;
  /** С этой даты начисляются проценты (обычно дата получения). */
  startDate: Date;
  /** Дата окончания договора: после неё проценты не начисляются. */
  endDate?: Date | null;
}

const daysInYear = (year: number) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365);

/**
 * Проценты по займу по месяцам до даты until включительно: каждый день —
 * остаток долга на начало дня × ставка / число дней в году; остаток — по
 * операциям займа (получение, погашение) до этого дня. Сумма месяца
 * округляется до копеек.
 */
export function interestSchedule(loan: LoanInterestInput, events: DebtEvent[], until: Date): MonthCharge[] {
  const rate = toDecimal(loan.annualRatePct).dividedBy(100);
  const sorted = [...events].sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = utcDay(loan.startDate);
  const last = Math.min(utcDay(until), loan.endDate ? utcDay(loan.endDate) : Infinity);
  const byMonth = new Map<number, Decimal>();
  let balance = new Decimal(0);
  let next = 0;
  // Debt before the first interest day counts from the very start.
  while (next < sorted.length && utcDay(sorted[next].date) < first) balance = balance.plus(sorted[next++].delta);
  for (let day = first; day <= last; day += DAY_MS) {
    if (balance.greaterThan(0)) {
      const date = new Date(day);
      const index = date.getUTCFullYear() * 12 + date.getUTCMonth();
      byMonth.set(index, (byMonth.get(index) ?? new Decimal(0)).plus(balance.times(rate).dividedBy(daysInYear(date.getUTCFullYear()))));
    }
    // Operations of the day change the balance from the next day: the day money arrives is not charged, the day it is repaid is.
    while (next < sorted.length && utcDay(sorted[next].date) <= day) balance = balance.plus(sorted[next++].delta);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, amount]) => ({ year: Math.floor(index / 12), month: (index % 12) + 1, amount: round2(amount) }))
    .filter((c) => !c.amount.isZero());
}
