import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { taxRate, taxSchedule, type TaxMonthInput } from "./taxes";

const d = (v: number) => new Decimal(v);
const month = (year: number, m: number, income: number, expenses = 0, profit = 0): TaxMonthInput => ({
  year,
  month: m,
  income: d(income),
  expenses: d(expenses),
  profit: d(profit),
});
const nums = (xs: Decimal[]) => xs.map((x) => x.toNumber());

describe("taxSchedule", () => {
  it("USN on income: accrues monthly, pays the quarter in April and July", () => {
    const months = [1, 2, 3, 4, 5, 6, 7].map((m) => month(2027, m, 100000));
    const s = taxSchedule("usn_income", d(6), months);
    expect(nums(s.map((x) => x.accrued))).toEqual([6000, 6000, 6000, 6000, 6000, 6000, 6000]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 18000, 0, 0, 18000]);
    expect(s[6].payableEnd.toNumber()).toBe(6000);
  });

  it("USN income minus expenses: the 1 % minimum tax for the year, paid in March", () => {
    const months = [
      month(2026, 10, 100000, 99000),
      month(2026, 11, 100000, 99000),
      month(2026, 12, 100000, 99000),
      month(2027, 1, 100000, 99000),
      month(2027, 2, 100000, 99000),
      month(2027, 3, 100000, 99000),
    ];
    const s = taxSchedule("usn_income_expense", d(15), months);
    // 15 % of 3 000 is 450, below 1 % of 300 000 income: the year's tax is 3 000.
    expect(nums(s.map((x) => x.accrued))).toEqual([150, 150, 2700, 150, 150, 150]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 0, 0, 3000]);
  });

  it("profit tax: a loss reduces the tax since the start of the year", () => {
    const months = [month(2027, 1, 0, 0, 100000), month(2027, 2, 0, 0, -150000), month(2027, 3, 0, 0, 100000), month(2027, 4, 0, 0, 0)];
    const s = taxSchedule("profit", d(25), months);
    expect(nums(s.map((x) => x.accrued))).toEqual([25000, -25000, 12500, 0]);
    expect(nums(s.map((x) => x.paid))).toEqual([0, 0, 0, 12500]);
  });

  it("uses the standard rate when none is set and nothing without a regime", () => {
    expect(taxRate("usn_income", null).toNumber()).toBe(6);
    expect(taxRate("usn_income_expense", "").toNumber()).toBe(15);
    expect(taxRate("profit", "20").toNumber()).toBe(20);
    expect(taxSchedule("none", d(0), [month(2027, 1, 100)])[0].accrued.toNumber()).toBe(0);
  });
});
