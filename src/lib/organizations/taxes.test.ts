import { describe, expect, it } from "vitest";
import { missingStandardRates, parseTaxRateForm, rateAt, validUntil } from "./taxes";
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
