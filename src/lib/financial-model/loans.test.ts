import { describe, expect, it } from "vitest";
import { parseLoanForm } from "./loans";

const valid = { name: "Кредит на оборудование", amount: "1 200 000", start: "2026-11", annualRatePct: "14,5", termMonths: "24", repayment: "annuity" };

describe("parseLoanForm", () => {
  it("parses a filled form, accepting spaces and a decimal comma", () => {
    const r = parseLoanForm(valid);
    if ("error" in r) throw new Error(r.error);
    expect(r.data).toMatchObject({ name: "Кредит на оборудование", startYear: 2026, startMonth: 11, termMonths: 24, repayment: "annuity" });
    expect([r.data.amount.toNumber(), r.data.annualRatePct.toNumber()]).toEqual([1200000, 14.5]);
  });

  it("treats an empty rate as an interest-free loan", () => {
    const r = parseLoanForm({ ...valid, annualRatePct: "" });
    expect("data" in r && r.data.annualRatePct.toNumber()).toBe(0);
  });

  it("rejects missing or impossible values", () => {
    for (const bad of [
      { name: " " },
      { amount: "0" },
      { start: "" },
      { annualRatePct: "150" },
      { termMonths: "0" },
      { termMonths: "12.5" },
      { repayment: "balloon" },
    ]) {
      expect(parseLoanForm({ ...valid, ...bad })).toHaveProperty("error");
    }
  });
});

describe("parseLoanForm — grace period and prepayment", () => {
  it("accepts a grace period shorter than the term and a prepayment within it", () => {
    const r = parseLoanForm({ ...valid, graceMonths: "3", prepayment: "2027-06", prepaymentAmount: "300 000" });
    if ("error" in r) throw new Error(r.error);
    expect([r.data.graceMonths, r.data.prepaymentYear, r.data.prepaymentMonth, r.data.prepaymentAmount?.toNumber()]).toEqual([3, 2027, 6, 300000]);
  });

  it("rejects a grace period as long as the term, a prepayment outside the payments or a half-filled prepayment", () => {
    for (const bad of <Array<Record<string, string>>>[
      { graceMonths: "24" },
      { prepayment: "2026-11", prepaymentAmount: "1000" }, // the month of the drawdown
      { prepayment: "2028-12", prepaymentAmount: "1000" }, // after the last payment
      { prepayment: "2027-06" },
      { prepaymentAmount: "1000" },
    ]) {
      expect("error" in parseLoanForm({ ...valid, ...bad })).toBe(true);
    }
  });
});

describe("organizationTax", () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  it("takes the regime from the tax system and the rate valid on 1 January of each year", async () => {
    const { organizationTax } = await import("./loans");
    const rates = [
      { taxKind: "usn", ratePct: "6", validFrom: utc(2026, 1, 1) },
      { taxKind: "usn", ratePct: "3", validFrom: utc(2027, 1, 1) },
    ];
    const tax = organizationTax({ name: "Альфа", taxSystem: "usn_income" }, rates, 2027);
    expect(tax.regime).toBe("usn_income");
    const rate = tax.ratePct as (y: number) => { toNumber(): number };
    expect([rate(2026).toNumber(), rate(2027).toNumber()]).toEqual([6, 3]);
    expect(tax.label).toBe("как у «Альфа»: УСН «доходы», 3% в 2027 году");
    // No own rate — the standard one; the patent is not a percentage tax.
    expect((organizationTax({ name: "Б", taxSystem: "osn" }, [], 2027).ratePct as (y: number) => { toNumber(): number })(2027).toNumber()).toBe(25);
    expect(organizationTax({ name: "ИП", taxSystem: "psn" }, [], 2027).regime).toBe("none");
  });
});

describe("organizationTax — sole proprietor", () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  it("adds the contributions from the card, on the income the tax uses; not on AUSN, only fixed ones on a patent", async () => {
    const { organizationTax } = await import("./loans");
    const rates = [
      { taxKind: "ip_insurance_fixed", ratePct: 0, fixedAmount: 57390, validFrom: utc(2026, 1, 1) },
      { taxKind: "ip_insurance_income", ratePct: 1, thresholdAmount: 300000, maxAmount: 321818, validFrom: utc(2026, 1, 1) },
    ];
    const usn = organizationTax({ name: "ИП Петров", taxSystem: "usn_income", type: "SOLE_PROPRIETOR" }, rates, 2026);
    expect(usn.ipContribution?.base).toBe("income");
    expect(usn.ipContribution?.forYear(2026).fixed?.toNumber()).toBe(57390);
    expect(usn.label.endsWith("; взносы ИП за себя")).toBe(true);
    expect(organizationTax({ name: "ИП", taxSystem: "osn", type: "SOLE_PROPRIETOR" }, rates, 2026).ipContribution?.base).toBe("income_minus_expenses");
    expect(organizationTax({ name: "ИП", taxSystem: "ausn_income", type: "SOLE_PROPRIETOR" }, rates, 2026).ipContribution).toBeNull();
    expect(organizationTax({ name: "ИП", taxSystem: "psn", type: "SOLE_PROPRIETOR" }, rates, 2026).ipContribution?.forYear(2026).income).toBeNull();
    expect(organizationTax({ name: "ООО", taxSystem: "usn_income", type: "LEGAL_ENTITY" }, rates, 2026).ipContribution).toBeNull();
  });
});
