import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { chargesIn, depreciationSchedule, interestSchedule } from "./non-cash";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const n = (d: Decimal) => d.toNumber();

describe("depreciationSchedule", () => {
  it("writes the cost off evenly from the month after commissioning, the last month taking the rounding", () => {
    const s = depreciationSchedule({ cost: 100000, commissioningDate: utc(2026, 3, 15), usefulLifeMonths: 3 });
    expect(s.map((c) => [c.year, c.month, n(c.amount)])).toEqual([
      [2026, 4, 33333.33],
      [2026, 5, 33333.33],
      [2026, 6, 33333.34],
    ]);
  });

  it("stops after the disposal month", () => {
    const s = depreciationSchedule({ cost: 120000, commissioningDate: utc(2026, 1, 10), usefulLifeMonths: 12, disposalDate: utc(2026, 4, 20) });
    expect(s.map((c) => c.month)).toEqual([2, 3, 4]);
  });

  it("sums the months whose last day falls in a period", () => {
    const s = depreciationSchedule({ cost: 120000, commissioningDate: utc(2025, 12, 1), usefulLifeMonths: 12 });
    expect(n(chargesIn(s, utc(2026, 1, 1), utc(2026, 3, 31)))).toBe(30000);
    expect(n(chargesIn(s, null, utc(2026, 3, 30)))).toBe(20000); // March is charged on the 31st
    expect(n(chargesIn(s, null, utc(2030, 1, 1)))).toBe(120000);
  });
});

describe("interestSchedule", () => {
  it("charges daily on the balance at the start of each day", () => {
    // 1 000 000 received on 1 Sep 2026 at 12 % a year; nothing repaid.
    const s = interestSchedule({ annualRatePct: 12, startDate: utc(2026, 9, 1) }, [{ date: utc(2026, 9, 1), delta: new Decimal(1000000) }], utc(2026, 10, 31));
    // September: 29 days (the day of receipt is not charged) × 1 000 000 × 12 % / 365.
    expect(s.map((c) => [c.month, n(c.amount)])).toEqual([
      [9, 9534.25],
      [10, 10191.78],
    ]);
  });

  it("follows repayments and the end of the agreement", () => {
    const events = [
      { date: utc(2026, 9, 1), delta: new Decimal(1000000) },
      { date: utc(2026, 9, 16), delta: new Decimal(-600000) },
    ];
    const s = interestSchedule({ annualRatePct: 12, startDate: utc(2026, 9, 1), endDate: utc(2026, 9, 30) }, events, utc(2026, 12, 31));
    // 15 days × 1 000 000 (2–16 Sep, the repayment day still charged) + 14 days × 400 000.
    expect(s.map((c) => [c.month, n(c.amount)])).toEqual([[9, 6772.6]]);
  });

  it("uses 366 days in a leap year and nothing without debt", () => {
    const leap = interestSchedule({ annualRatePct: 36.6, startDate: utc(2028, 1, 1) }, [{ date: utc(2027, 12, 31), delta: new Decimal(1000) }], utc(2028, 1, 1));
    expect(n(leap[0].amount)).toBe(1); // 1000 × 36.6 % / 366
    expect(interestSchedule({ annualRatePct: 10, startDate: utc(2026, 1, 1) }, [], utc(2026, 12, 31))).toEqual([]);
  });
});

describe("organizationFilter", () => {
  it("intersects the report filter with the access scope", async () => {
    const { organizationFilter } = await import("./non-cash-load");
    expect(organizationFilter(undefined, null)).toBeNull();
    expect(organizationFilter("a", null)).toEqual(["a"]);
    expect(organizationFilter("a", ["b"])).toEqual([]);
    expect(organizationFilter(undefined, ["b"])).toEqual(["b"]);
  });
});
