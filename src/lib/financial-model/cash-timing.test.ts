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
