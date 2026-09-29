import Decimal from "decimal.js";
import { toDecimal, type MoneyInput } from "./money";

/**
 * Валюты счетов и пересчёт в рубли. Операция по валютному счёту — в рублях
 * по курсу ЦБ на дату операции; остаток — по курсу на дату отчёта; разница
 * между ними — курсовая разница.
 */
export const BASE_CURRENCY = "RUB";

export const CURRENCY_OPTIONS = [
  { value: "RUB", label: "RUB — российский рубль" },
  { value: "USD", label: "USD — доллар США" },
  { value: "EUR", label: "EUR — евро" },
  { value: "CNY", label: "CNY — китайский юань" },
  { value: "KZT", label: "KZT — казахстанский тенге" },
  { value: "BYN", label: "BYN — белорусский рубль" },
  { value: "AED", label: "AED — дирхам ОАЭ" },
  { value: "TRY", label: "TRY — турецкая лира" },
  { value: "INR", label: "INR — индийская рупия" },
  { value: "GBP", label: "GBP — фунт стерлингов" },
  { value: "CHF", label: "CHF — швейцарский франк" },
  { value: "JPY", label: "JPY — японская иена" },
  { value: "HKD", label: "HKD — гонконгский доллар" },
  { value: "UZS", label: "UZS — узбекский сум" },
  { value: "KGS", label: "KGS — киргизский сом" },
  { value: "AMD", label: "AMD — армянский драм" },
];

const ALIASES: Record<string, string> = { RUR: "RUB", "РУБ": "RUB", "Р": "RUB", "₽": "RUB", $: "USD", "€": "EUR", "¥": "CNY", "ЮАНЬ": "CNY" };

/** Код валюты из справочника: пусто и «руб» — рубли, иначе три буквы в верхнем регистре. */
export function normalizeCurrency(raw: unknown): string {
  const text = String(raw ?? "").trim().toUpperCase().replace(/\.$/, "");
  if (!text) return BASE_CURRENCY;
  return ALIASES[text] ?? text;
}

export const isBaseCurrency = (currency: unknown) => normalizeCurrency(currency) === BASE_CURRENCY;

/** Валюта счёта операции (банк или касса). */
export function transactionCurrency(tx: { bankAccount?: { currency: string } | null; cashAccount?: { currency: string } | null }): string {
  return normalizeCurrency(tx.bankAccount?.currency ?? tx.cashAccount?.currency);
}

const dayKey = (date: Date) => date.toISOString().slice(0, 10);

export interface RateRow {
  currency: string;
  date: Date;
  rate: MoneyInput;
}

/**
 * Курсы в памяти: курс на дату — последний известный не позже неё (курс ЦБ,
 * установленный в субботу, действует и в воскресенье, и в понедельник).
 * Если курса на дату ещё нет — берётся ближайший более поздний, а валюта с
 * датой попадает в missing: отчёт покажет предупреждение.
 */
export class RateLookup {
  private byCurrency = new Map<string, Array<{ key: string; rate: Decimal }>>();
  readonly missing = new Map<string, string>();

  constructor(rows: RateRow[]) {
    for (const row of rows) {
      const currency = normalizeCurrency(row.currency);
      const list = this.byCurrency.get(currency) ?? [];
      list.push({ key: dayKey(row.date), rate: toDecimal(row.rate) });
      this.byCurrency.set(currency, list);
    }
    for (const list of this.byCurrency.values()) list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** Рублей за единицу валюты на дату; null — курсов этой валюты нет совсем. */
  rateOn(currencyRaw: string, date: Date): Decimal | null {
    const currency = normalizeCurrency(currencyRaw);
    if (currency === BASE_CURRENCY) return new Decimal(1);
    const list = this.byCurrency.get(currency);
    const key = dayKey(date);
    if (!list || list.length === 0) {
      this.noteMissing(currency, key);
      return null;
    }
    // Binary search for the last rate on or before the date.
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].key <= key) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found >= 0) return list[found].rate;
    this.noteMissing(currency, key);
    return list[0].rate;
  }

  /** Сумма в рублях по курсу на дату (до копеек). Без курса вовсе — как есть, с пометкой в missing. */
  toRub(amount: MoneyInput, currency: string, date: Date): Decimal {
    const value = toDecimal(amount);
    const rate = this.rateOn(currency, date);
    return rate ? value.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : value;
  }

  private noteMissing(currency: string, key: string) {
    const earliest = this.missing.get(currency);
    if (!earliest || key < earliest) this.missing.set(currency, key);
  }

  /** Предупреждение для отчёта: «нет курса USD на 01.03.2026 и раньше». */
  missingText(): string | null {
    if (this.missing.size === 0) return null;
    const show = (key: string) => `${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}`;
    return [...this.missing.entries()].map(([currency, key]) => `${currency} на ${show(key)}`).join(", ");
  }
}

/**
 * Остаток в рублях по курсу на дату отчёта и курсовая разница: остатки
 * по валютам (в валюте счёта) переводятся по курсу на дату, а движения уже
 * посчитаны по курсам своих дат. Разница — переоценка валютных остатков.
 */
export function revalueBalances(nativeByCurrency: Map<string, Decimal>, date: Date, rates: RateLookup): Decimal {
  let total = new Decimal(0);
  for (const [currency, amount] of nativeByCurrency) total = total.plus(rates.toRub(amount, currency, date));
  return total;
}

/** Добавить движение к остаткам по валютам. */
export function addNative(map: Map<string, Decimal>, currency: string, signed: Decimal) {
  map.set(currency, (map.get(currency) ?? new Decimal(0)).plus(signed));
}

// --- Официальные курсы ЦБ РФ (https://www.cbr.ru/development/SXML/) ---

/** Внутренние коды валют ЦБ (постоянные) — для запроса истории курса без лишнего запроса списка. */
export const CBR_CURRENCY_IDS: Record<string, string> = {
  USD: "R01235",
  EUR: "R01239",
  CNY: "R01375",
  KZT: "R01335",
  BYN: "R01090B",
  AED: "R01230",
  TRY: "R01700J",
  INR: "R01270",
  GBP: "R01035",
  CHF: "R01775",
  JPY: "R01820",
  HKD: "R01200",
  UZS: "R01717",
  KGS: "R01370",
  AMD: "R01060",
};

const cbrDate = (text: string): Date | null => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]))) : null;
};
const cbrNumber = (text: string) => new Decimal(text.replace(/\s/g, "").replace(",", "."));
const tag = (xml: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? null;

/** Курсы на день (XML_daily): дата установления, валюты с кодом ЦБ и курсом за единицу. */
export function parseCbrDaily(xml: string): { date: Date | null; rates: Array<{ cbrId: string; currency: string; rate: Decimal }> } {
  const date = cbrDate(/<ValCurs[^>]*Date="([^"]+)"/.exec(xml)?.[1] ?? "");
  const rates: Array<{ cbrId: string; currency: string; rate: Decimal }> = [];
  for (const m of xml.matchAll(/<Valute ID="([^"]+)">([\s\S]*?)<\/Valute>/g)) {
    const code = tag(m[2], "CharCode");
    const nominal = tag(m[2], "Nominal");
    const value = tag(m[2], "Value");
    if (!code || !nominal || !value) continue;
    rates.push({ cbrId: m[1], currency: code.trim().toUpperCase(), rate: cbrNumber(value).dividedBy(cbrNumber(nominal)).toDecimalPlaces(6) });
  }
  return { date, rates };
}

/** Динамика курса одной валюты (XML_dynamic): дата — курс за единицу. */
export function parseCbrDynamic(xml: string): Array<{ date: Date; rate: Decimal }> {
  const result: Array<{ date: Date; rate: Decimal }> = [];
  for (const m of xml.matchAll(/<Record Date="([^"]+)"[^>]*>([\s\S]*?)<\/Record>/g)) {
    const date = cbrDate(m[1]);
    const nominal = tag(m[2], "Nominal");
    const value = tag(m[2], "Value");
    if (!date || !nominal || !value) continue;
    result.push({ date, rate: cbrNumber(value).dividedBy(cbrNumber(nominal)).toDecimalPlaces(6) });
  }
  return result;
}

/** Дата для запроса ЦБ: ДД/ММ/ГГГГ. */
export const cbrRequestDate = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;

/** Сумма со знаком валюты счёта; неизвестный код — просто число с кодом. */
export function formatMoneyIn(value: MoneyInput, currencyRaw: unknown): string {
  const currency = normalizeCurrency(currencyRaw);
  const num = toDecimal(value).toNumber();
  if (!/^[A-Z]{3}$/.test(currency)) return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(num)} ${currency}`;
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 2 }).format(num);
}
