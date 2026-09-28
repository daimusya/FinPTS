import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { loanSchedule, shiftByLag, type LoanInput } from "./cash-timing";

const d = (v: number) => new Decimal(v);
const nums = (xs: Decimal[]) => xs.map((x) => x.toNumber());

describe("shiftByLag", () => {
  it("keeps money in its month without a delay", () => {
    const r = shiftByLag([d(100), d(200)], [0, 0]);
    expect(nums(r.byMonth)).toEqual([100, 200]);
    expect(r.beyond.toNumber()).toBe(0);
  });

  it("moves a whole-month delay and leaves the tail beyond the horizon", () => {
    const r = shiftByLag([d(100), d(200), d(300)], [30, 30, 30]);
    expect(nums(r.byMonth)).toEqual([0, 100, 200]);
    expect(r.beyond.toNumber()).toBe(300);
  });

  it("splits a fractional delay between two months (45 days = half next month, half the month after)", () => {
    const r = shiftByLag([d(1000), d(0), d(0), d(0)], [45, 0, 0, 0]);
    expect(nums(r.byMonth)).toEqual([0, 500, 500, 0]);
  });

  it("uses the delay of the month the money was earned in", () => {
    const r = shiftByLag([d(100), d(100), d(100)], [0, 30, 0]);
    expect(nums(r.byMonth)).toEqual([100, 0, 200]);
  });
});

describe("loanSchedule", () => {
  const base: LoanInput = {
    id: "l1",
    name: "Кредит",
    amount: d(1200000),
    startIndex: 2026 * 12 + 9, // October 2026
    annualRatePct: d(12),
    termMonths: 12,
    repayment: "linear",
  };
  const months = (loan: LoanInput) => [...loanSchedule(loan).entries()].sort((a, b) => a[0] - b[0]).map(([, m]) => m);

  it("draws the money in the start month and repays equal principal with interest on the balance", () => {
    const m = months(base);
    expect(m[0].drawdown.toNumber()).toBe(1200000);
    expect([m[1].principal.toNumber(), m[1].interest.toNumber()]).toEqual([100000, 12000]); // 1% of 1 200 000
    expect([m[2].principal.toNumber(), m[2].interest.toNumber()]).toEqual([100000, 11000]);
    expect(m[12].balance.toNumber()).toBe(0);
    expect(m.reduce((s, x) => s.plus(x.interest), d(0)).toNumber()).toBe(78000); // 12 000 + 11 000 + … + 1 000
  });

  it("pays equal annuity instalments and closes the debt exactly", () => {
    const m = months({ ...base, repayment: "annuity" });
    const payment = (x: (typeof m)[number]) => x.principal.plus(x.interest).toNumber();
    expect(payment(m[1])).toBe(106618.55); // 1 200 000 × 0.01 / (1 − 1.01^−12)
    expect(payment(m[6])).toBe(106618.55);
    expect(m[12].balance.toNumber()).toBe(0);
    expect(m.reduce((s, x) => s.plus(x.principal), d(0)).toNumber()).toBe(1200000);
  });

  it("charges only interest until the last month for a bullet loan", () => {
    const m = months({ ...base, repayment: "bullet", termMonths: 3 });
    expect(nums(m.map((x) => x.principal))).toEqual([0, 0, 0, 1200000]);
    expect(nums(m.map((x) => x.interest))).toEqual([0, 12000, 12000, 12000]);
  });

  it("spreads an interest-free loan evenly", () => {
    const m = months({ ...base, repayment: "annuity", annualRatePct: d(0), termMonths: 4 });
    expect(nums(m.slice(1).map((x) => x.principal))).toEqual([300000, 300000, 300000, 300000]);
  });
});

describe("loanSchedule — grace period and prepayment", () => {
  const base = { id: "l", name: "Кредит", startIndex: 2027 * 12, termMonths: 12 };

  it("charges only interest during the grace period, then repays over the rest of the term", () => {
    const s = loanSchedule({ ...base, amount: d(1200000), annualRatePct: d(12), repayment: "linear", graceMonths: 2 });
    const payments = [...s.entries()].filter(([i]) => i > base.startIndex).map(([, m]) => m);
    expect(nums(payments.slice(0, 3).map((m) => m.principal))).toEqual([0, 0, 120000]);
    expect(nums(payments.slice(0, 3).map((m) => m.interest))).toEqual([12000, 12000, 12000]);
    expect(payments.reduce((a, m) => a.plus(m.principal), d(0)).toNumber()).toBe(1200000);
    expect(payments[11].balance.toNumber()).toBe(0);
  });

  it("a prepayment lowers the later payments and keeps the term", () => {
    const s = loanSchedule({
      ...base,
      amount: d(1200000),
      annualRatePct: d(0),
      repayment: "linear",
      prepayment: { index: base.startIndex + 3, amount: d(300000) },
    });
    const payments = [...s.entries()].filter(([i]) => i > base.startIndex).map(([, m]) => m);
    expect(nums(payments.slice(0, 4).map((m) => m.principal))).toEqual([100000, 100000, 400000, 66666.67]);
    expect(payments[11].principal.toNumber()).toBe(66666.64);
    expect(payments[11].balance.toNumber()).toBe(0);
  });

  it("an annuity recalculated after a prepayment still ends at zero; a prepayment above the debt closes the loan", () => {
    const s = loanSchedule({ ...base, amount: d(1200000), annualRatePct: d(12), repayment: "annuity", prepayment: { index: base.startIndex + 6, amount: d(200000) } });
    const payments = [...s.entries()].filter(([i]) => i > base.startIndex).map(([, m]) => m);
    expect(payments[0].principal.plus(payments[0].interest).toNumber()).toBe(106618.55);
    expect(payments[6].principal.plus(payments[6].interest).toNumber()).toBeLessThan(106618.55);
    expect(payments.reduce((a, m) => a.plus(m.principal), d(0)).toNumber()).toBe(1200000);
    const closed = loanSchedule({ ...base, amount: d(100000), annualRatePct: d(0), repayment: "linear", prepayment: { index: base.startIndex + 2, amount: d(500000) } });
    expect(Math.max(...closed.keys())).toBe(base.startIndex + 2);
    expect(closed.get(base.startIndex + 2)!.balance.toNumber()).toBe(0);
  });
});
