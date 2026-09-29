import { describe, expect, it } from "vitest";
import { describeRate, missingStandardRates, parseTaxRateForm, rateAt, validUntil } from "./taxes";
import { combineTaxRates } from "@/lib/payroll/calculate";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const rates = [
  { taxKind: "usn", ratePct: "6", validFrom: utc(2025, 1, 1) },
  { taxKind: "usn", ratePct: "4", validFrom: utc(2027, 1, 1) },
  { taxKind: "vat", ratePct: "5", validFrom: utc(2026, 1, 1) },
];

describe("organization tax rates", () => {
  it("takes the rate with the latest start not after the date", () => {
    expect(rateAt(rates, "usn", utc(2026, 12, 31))?.toNumber()).toBe(6);
    expect(rateAt(rates, "usn", utc(2027, 1, 1))?.toNumber()).toBe(4);
    expect(rateAt(rates, "vat", utc(2025, 6, 1))).toBeNull();
    expect(rateAt(rates, "profit", utc(2027, 1, 1))).toBeNull();
  });

  it("a rate is valid until the day before the next one of the same tax", () => {
    expect(validUntil(rates, rates[0])?.toISOString().slice(0, 10)).toBe("2026-12-31");
    expect(validUntil(rates, rates[1])).toBeNull();
    expect(validUntil(rates, rates[2])).toBeNull();
  });

  it("checks the form: tax, rate from 0 to 100 and a real date", () => {
    const ok = parseTaxRateForm({ taxKind: "vat", ratePct: "7,5", validFrom: "2026-01-01", comment: " льгота " });
    if ("error" in ok) throw new Error(ok.error);
    expect([ok.value.ratePct.toNumber(), ok.value.validFrom.toISOString().slice(0, 10), ok.value.comment]).toEqual([7.5, "2026-01-01", "льгота"]);
    for (const bad of [
      { taxKind: "x", ratePct: "5", validFrom: "2026-01-01" },
      { taxKind: "vat", ratePct: "101", validFrom: "2026-01-01" },
      { taxKind: "vat", ratePct: "-1", validFrom: "2026-01-01" },
      { taxKind: "vat", ratePct: "5", validFrom: "2026-02-30" },
      { taxKind: "vat", ratePct: "5", validFrom: "" },
    ]) {
      expect("error" in parseTaxRateForm(bad)).toBe(true);
    }
  });

  it("offers only the standard rates of taxes that have no rate yet", () => {
    expect(missingStandardRates("osn", rates)).toEqual([{ kind: "profit", ratePct: 25 }]);
    expect(missingStandardRates("usn_income", rates)).toEqual([]);
    expect(missingStandardRates("psn", [])).toEqual([]);
  });

  it("payroll: the organization's own tariffs replace the general rules on their dates", () => {
    const rules = [
      { base: "ndfl", ratePct: "13" },
      { base: "pension", ratePct: "22" },
      { base: "medical", ratePct: "5.1" },
      { base: "social", ratePct: "2.9" },
      { base: "injury", ratePct: "0.2" },
    ];
    const own = [
      { taxKind: "insurance", ratePct: "15", validFrom: utc(2026, 1, 1) },
      { taxKind: "injury", ratePct: "0.5", validFrom: utc(2026, 7, 1) },
    ];
    expect(combineTaxRates(rules, [], utc(2026, 9, 1)).insurancePct.toNumber()).toBe(30.2);
    expect(combineTaxRates(rules, own, utc(2026, 3, 1)).insurancePct.toNumber()).toBe(15.2);
    expect(combineTaxRates(rules, own, utc(2026, 9, 1)).insurancePct.toNumber()).toBe(15.5);
    expect(combineTaxRates(rules, own, utc(2025, 12, 31)).insurancePct.toNumber()).toBe(30.2);
    expect(combineTaxRates(rules, own, utc(2026, 9, 1)).ndflPct.toNumber()).toBe(13);
  });
});

describe("sole proprietor's own contributions", () => {
  it("fixed ones are an amount a year, the ones on income need a threshold", () => {
    const fixed = parseTaxRateForm({ taxKind: "ip_insurance_fixed", ratePct: "", fixedAmount: "57 390", validFrom: "2026-01-01" });
    if ("error" in fixed) throw new Error(fixed.error);
    expect([fixed.value.fixedAmount?.toNumber(), fixed.value.ratePct.toNumber()]).toEqual([57390, 0]);
    expect("error" in parseTaxRateForm({ taxKind: "ip_insurance_fixed", fixedAmount: "", validFrom: "2026-01-01" })).toBe(true);
    const income = parseTaxRateForm({ taxKind: "ip_insurance_income", ratePct: "1", thresholdAmount: "300000", maxAmount: "", validFrom: "2026-01-01" });
    if ("error" in income) throw new Error(income.error);
    expect([income.value.thresholdAmount?.toNumber(), income.value.maxAmount]).toEqual([300000, null]);
    expect("error" in parseTaxRateForm({ taxKind: "ip_insurance_income", ratePct: "1", thresholdAmount: "", validFrom: "2026-01-01" })).toBe(true);
    // Another tax ignores the amounts.
    const vat = parseTaxRateForm({ taxKind: "vat", ratePct: "5", thresholdAmount: "1", fixedAmount: "2", validFrom: "2026-01-01" });
    expect("value" in vat && [vat.value.thresholdAmount, vat.value.fixedAmount]).toEqual([null, null]);
  });

  it("standard rates of a sole proprietor include the contributions of the year, except on AUSN", () => {
    expect(missingStandardRates("usn_income", [], "SOLE_PROPRIETOR", 2026)).toEqual([
      { kind: "usn", ratePct: 6 },
      { kind: "ip_insurance_fixed", ratePct: 0, fixedAmount: 57390 },
      { kind: "ip_insurance_income", ratePct: 1, thresholdAmount: 300000, maxAmount: 321818 },
    ]);
    expect(missingStandardRates("usn_income", [], "LEGAL_ENTITY", 2026)).toEqual([{ kind: "usn", ratePct: 6 }]);
    expect(missingStandardRates("ausn_income", [], "SOLE_PROPRIETOR", 2026)).toEqual([{ kind: "ausn", ratePct: 8 }]);
    // A year without known amounts: no fixed ones, the 1 % without a maximum.
    expect(missingStandardRates("psn", [], "SOLE_PROPRIETOR", 2030)).toEqual([{ kind: "ip_insurance_income", ratePct: 1, thresholdAmount: 300000, maxAmount: null }]);
  });

  it("describes the rates for the screen", () => {
    const format = (n: { toString(): string }) => `${n} ₽`;
    expect(describeRate({ taxKind: "ip_insurance_fixed", ratePct: 0, fixedAmount: 57390, validFrom: utc(2026, 1, 1) }, format)).toBe("57390 ₽ в год");
    expect(describeRate({ taxKind: "ip_insurance_income", ratePct: 1, thresholdAmount: 300000, maxAmount: 321818, validFrom: utc(2026, 1, 1) }, format)).toBe(
      "1% с дохода свыше 300000 ₽, не более 321818 ₽ в год",
    );
    expect(describeRate({ taxKind: "vat", ratePct: "7.5", validFrom: utc(2026, 1, 1) }, format)).toBe("7,5%");
  });
});
