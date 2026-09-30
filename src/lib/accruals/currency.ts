import Decimal from "decimal.js";
import { toDecimal, type MoneyInput } from "@/lib/money";
import { BASE_CURRENCY, normalizeCurrency } from "@/lib/currency";

/**
 * Документы начисления в иностранной валюте. Суммы строк хранятся в валюте
 * (currencyAmount) и в рублях по курсу на дату документа (amount) — доход и
 * расход признаются по этому курсу, поэтому ОПиУ и маржинальность считают
 * рубли как раньше. Оплата учитывается в валюте документа; курсовые разницы
 * возникают при оплате (курс дня оплаты против курса документа) и на дату
 * баланса (переоценка неоплаченного остатка).
 */

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export const isForeign = (currency: string | null | undefined) => normalizeCurrency(currency) !== BASE_CURRENCY;

/** Рубли по курсу: сумма в валюте × курс, до копеек. */
export function toRubAtRate(amount: MoneyInput, rate: MoneyInput): Decimal {
  return round2(toDecimal(amount).times(toDecimal(rate)));
}

/** Курс из формы: пусто — взять курс ЦБ; иначе положительное число до 6 знаков. */
export function parseRate(raw: string): { rate: Decimal | null } | { error: string } {
  const text = raw.replace(/\s/g, "").replace(",", ".");
  if (!text) return { rate: null };
  if (!/^\d+(\.\d{1,6})?$/.test(text) || toDecimal(text).lessThanOrEqualTo(0)) return { error: "Курс — положительное число, не больше 6 знаков после запятой" };
  return { rate: toDecimal(text) };
}

/** Строка документа: для валютного документа — сумма и НДС в валюте, рубли по курсу. */
export function lineAmounts(input: { amount: number; vatAmount: number | null }, rate: Decimal | null) {
  if (!rate) return { amount: input.amount, vatAmount: input.vatAmount, currencyAmount: null, currencyVatAmount: null };
  return {
    amount: toRubAtRate(input.amount, rate).toNumber(),
    vatAmount: input.vatAmount === null ? null : toRubAtRate(input.vatAmount, rate).toNumber(),
    currencyAmount: input.amount,
    currencyVatAmount: input.vatAmount,
  };
}

export interface AllocationAmounts {
  amount: Decimal;
  currencyAmount: Decimal | null;
  transactionAmount: Decimal | null;
}

/** Сумма сопоставления со стороны операции — в валюте её счёта. */
export const allocationTransactionSide = (a: { amount: MoneyInput; transactionAmount?: MoneyInput | null }) => toDecimal(a.transactionAmount ?? a.amount);

/** Сумма сопоставления со стороны документа — в валюте документа. */
export const allocationDocumentSide = (a: { amount: MoneyInput; currencyAmount?: MoneyInput | null }) => toDecimal(a.currencyAmount ?? a.amount);

/**
 * Сопоставление оплаты с документом. entered — сумма в валюте платежа (что
 * реально пришло или ушло). Варианты:
 * — валюты совпадают: сумма и есть сумма документа;
 * — платёж в рублях по документу в валюте (договор в «у.е.»): в валюте
 *   документа — по курсу дня оплаты;
 * — платёж в валюте по рублёвому документу: рубли — по курсу дня оплаты;
 * — две разные иностранные валюты — не поддерживается.
 * amount — всегда рубли по курсу документа (на столько уменьшается долг).
 */
export function planAllocation(input: {
  entered: MoneyInput;
  transactionCurrency: string;
  documentCurrency: string;
  documentRate: MoneyInput | null;
  /** Курс валюты платежа или документа на день оплаты (нужен, когда валюты разные). */
  paymentDayRate: MoneyInput | null;
}): AllocationAmounts | { error: string } {
  const entered = toDecimal(input.entered);
  const tx = normalizeCurrency(input.transactionCurrency);
  const doc = normalizeCurrency(input.documentCurrency);
  if (tx === doc) {
    if (doc === BASE_CURRENCY) return { amount: entered, currencyAmount: null, transactionAmount: null };
    if (!input.documentRate) return { error: "У документа в валюте не указан курс" };
    return { amount: toRubAtRate(entered, input.documentRate), currencyAmount: entered, transactionAmount: entered };
  }
  if (tx !== BASE_CURRENCY && doc !== BASE_CURRENCY) return { error: `Платёж в ${tx} нельзя сопоставить с документом в ${doc} — валюты разные` };
  if (!input.paymentDayRate) return { error: `Нет курса ${tx === BASE_CURRENCY ? doc : tx} на день оплаты — загрузите курсы ЦБ в справочнике «Курсы валют»` };
  if (tx === BASE_CURRENCY) {
    if (!input.documentRate) return { error: "У документа в валюте не указан курс" };
    const inCurrency = round2(entered.dividedBy(toDecimal(input.paymentDayRate)));
    return { amount: toRubAtRate(inCurrency, input.documentRate), currencyAmount: inCurrency, transactionAmount: entered };
  }
  return { amount: toRubAtRate(entered, input.paymentDayRate), currencyAmount: null, transactionAmount: entered };
}

/**
 * Курсовая разница при оплате: рубли, реально полученные или уплаченные по
 * курсу дня оплаты, против рублей по курсу документа. По доходу получили
 * больше — прибыль; по расходу заплатили больше — убыток.
 */
export function realizedFx(direction: "INCOME" | "EXPENSE", paidRub: MoneyInput, bookedRub: MoneyInput): Decimal {
  const diff = toDecimal(paidRub).minus(toDecimal(bookedRub));
  return direction === "INCOME" ? diff : diff.negated();
}

/**
 * Переоценка неоплаченного остатка валютного документа на дату: остаток в
 * валюте по курсу даты против рублей по курсу документа. Долг покупателя
 * подорожал — прибыль; наш долг поставщику подорожал — убыток.
 */
export function revaluedRemaining(direction: "INCOME" | "EXPENSE", remainingInCurrency: MoneyInput, documentRate: MoneyInput, reportRate: MoneyInput) {
  const booked = toRubAtRate(remainingInCurrency, documentRate);
  const revalued = toRubAtRate(remainingInCurrency, reportRate);
  const diff = revalued.minus(booked);
  return { revalued, difference: direction === "INCOME" ? diff : diff.negated() };
}

/** Итог документа в его валюте: сумма строк в валюте (или в рублях для рублёвого). */
export function documentTotal(lines: Array<{ amount: MoneyInput; currencyAmount?: MoneyInput | null }>, foreign: boolean): Decimal {
  return lines.reduce<Decimal>((sum, l) => sum.plus(toDecimal(foreign ? (l.currencyAmount ?? 0) : l.amount)), new Decimal(0));
}

export interface OutstandingDocument {
  currency: string;
  exchangeRate: MoneyInput | null;
  lines: Array<{ amount: MoneyInput; currencyAmount?: MoneyInput | null }>;
  allocations: Array<{ amount: MoneyInput; currencyAmount?: MoneyInput | null }>;
}

/**
 * Неоплаченный остаток документа: в его валюте и в рублях. Рублёвый документ —
 * как раньше (строки минус оплаты). Валютный — остаток в валюте по курсу rate
 * (курс на дату отчёта; нет курса — курс документа).
 */
export function outstanding(doc: OutstandingDocument, rateOnDate: MoneyInput | null): { native: Decimal; rub: Decimal } {
  if (!isForeign(doc.currency) || !doc.exchangeRate) {
    const rub = doc.lines.reduce<Decimal>((s, l) => s.plus(toDecimal(l.amount)), new Decimal(0)).minus(
      doc.allocations.reduce<Decimal>((s, a) => s.plus(toDecimal(a.amount)), new Decimal(0)),
    );
    return { native: rub, rub };
  }
  const native = documentTotal(doc.lines, true).minus(doc.allocations.reduce<Decimal>((s, a) => s.plus(allocationDocumentSide(a)), new Decimal(0)));
  return { native, rub: toRubAtRate(native, rateOnDate ?? doc.exchangeRate) };
}
