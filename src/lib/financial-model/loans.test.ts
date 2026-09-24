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
