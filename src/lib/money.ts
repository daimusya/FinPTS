import Decimal from "decimal.js";

export type MoneyInput = Decimal | number | string | { toString(): string };

export function toDecimal(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  return new Decimal(String(value));
}

export function sumMoney(values: MoneyInput[]): Decimal {
  return values.reduce((acc: Decimal, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

export function formatMoney(value: MoneyInput, currency = "RUB"): string {
  const num = toDecimal(value).toNumber();
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatNumber(value: MoneyInput): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(toDecimal(value).toNumber());
}
