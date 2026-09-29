import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { addNative, formatMoneyIn, normalizeCurrency, parseCbrDaily, parseCbrDynamic, RateLookup, revalueBalances, transactionCurrency } from "./currency";

const d = (key: string) => new Date(`${key}T00:00:00Z`);

describe("normalizeCurrency", () => {
  it("treats empty and rouble spellings as RUB and upper-cases codes", () => {
    expect(normalizeCurrency("")).toBe("RUB");
    expect(normalizeCurrency(null)).toBe("RUB");
    expect(normalizeCurrency("руб.")).toBe("RUB");
    expect(normalizeCurrency("RUR")).toBe("RUB");
    expect(normalizeCurrency(" usd ")).toBe("USD");
    expect(normalizeCurrency("€")).toBe("EUR");
    expect(transactionCurrency({ bankAccount: null, cashAccount: { currency: "cny" } })).toBe("CNY");
    expect(transactionCurrency({ bankAccount: { currency: "RUB" }, cashAccount: null })).toBe("RUB");
  });
});

describe("RateLookup", () => {
  const rates = new RateLookup([
    { currency: "USD", date: d("2026-09-25"), rate: "84.9057" },
    { currency: "USD", date: d("2026-09-27"), rate: "85.1000" },
    { currency: "EUR", date: d("2026-09-27"), rate: "98.5" },
  ]);

  it("uses the last rate on or before the date (a Saturday rate holds over the weekend)", () => {
    expect(rates.rateOn("USD", d("2026-09-25"))!.toString()).toBe("84.9057");
    expect(rates.rateOn("USD", d("2026-09-26"))!.toString()).toBe("84.9057");
    expect(rates.rateOn("USD", d("2026-09-30"))!.toString()).toBe("85.1");
    expect(rates.rateOn("RUB", d("2026-01-01"))!.toString()).toBe("1");
    expect(rates.missingText()).toBeNull();
  });

  it("converts to rubles to the kopeck", () => {
    expect(rates.toRub("100.50", "USD", d("2026-09-26")).toFixed(2)).toBe("8533.02");
    expect(rates.toRub("100", "RUB", d("2026-09-26")).toFixed(2)).toBe("100.00");
  });

  it("falls back to the nearest later rate or the amount as is, and reports what is missing", () => {
    const lookup = new RateLookup([{ currency: "USD", date: d("2026-09-25"), rate: "84" }]);
    expect(lookup.toRub(10, "USD", d("2026-09-01")).toNumber()).toBe(840);
    expect(lookup.toRub(10, "CNY", d("2026-09-10")).toNumber()).toBe(10);
    expect(lookup.toRub(10, "CNY", d("2026-09-05")).toNumber()).toBe(10);
    expect(lookup.missingText()).toBe("USD на 01.09.2026, CNY на 05.09.2026");
  });

  it("revalues balances per currency at the report date", () => {
    const balances = new Map<string, Decimal>();
    addNative(balances, "RUB", new Decimal(1000));
    addNative(balances, "USD", new Decimal(100));
    addNative(balances, "USD", new Decimal(-40));
    addNative(balances, "EUR", new Decimal(10));
    // 1000 + 60 × 85.1 + 10 × 98.5
    expect(revalueBalances(balances, d("2026-09-28"), rates).toFixed(2)).toBe("7091.00");
  });
});

describe("CBR XML", () => {
  it("parses the daily list with nominals", () => {
    const xml =
      '<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="26.09.2026" name="Foreign Currency Market">' +
      '<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>x</Name><Value>84,9057</Value><VunitRate>84,9057</VunitRate></Valute>' +
      '<Valute ID="R01335"><NumCode>398</NumCode><CharCode>KZT</CharCode><Nominal>100</Nominal><Name>x</Name><Value>16,1234</Value><VunitRate>0,161234</VunitRate></Valute>' +
      "</ValCurs>";
    const parsed = parseCbrDaily(xml);
    expect(parsed.date?.toISOString().slice(0, 10)).toBe("2026-09-26");
    expect(parsed.rates.map((r) => [r.cbrId, r.currency, r.rate.toString()])).toEqual([
      ["R01235", "USD", "84.9057"],
      ["R01335", "KZT", "0.161234"],
    ]);
  });

  it("parses the history of one currency", () => {
    const xml =
      '<ValCurs ID="R01235" DateRange1="20.09.2026" DateRange2="29.09.2026" name="Foreign Currency Market Dynamic">' +
      '<Record Date="22.09.2026" Id="R01235"><Nominal>1</Nominal><Value>84,0954</Value><VunitRate>84,0954</VunitRate></Record>' +
      '<Record Date="23.09.2026" Id="R01235"><Nominal>1</Nominal><Value>84,0657</Value><VunitRate>84,0657</VunitRate></Record></ValCurs>';
    expect(parseCbrDynamic(xml).map((r) => [r.date.toISOString().slice(0, 10), r.rate.toString()])).toEqual([
      ["2026-09-22", "84.0954"],
      ["2026-09-23", "84.0657"],
    ]);
  });

  it("formats a sum in the account currency", () => {
    expect(formatMoneyIn(1234.5, "USD")).toContain("$");
    expect(formatMoneyIn(10, "RUB")).toContain("₽");
    expect(formatMoneyIn(10, "ДОЛЛ")).toBe("10 ДОЛЛ");
  });
});
