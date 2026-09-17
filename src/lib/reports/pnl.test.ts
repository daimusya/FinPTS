import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { derivePnlTotals } from "./pnl";

function d(n: number) {
  return new Decimal(n);
}

describe("derivePnlTotals", () => {
  it("computes the full waterfall: gross -> operating -> net profit", () => {
    const totals = derivePnlTotals({
      revenue: d(1000),
      directVariable: d(300),
      directFixed: d(100),
      indirect: d(200),
      otherIncome: d(50),
      otherExpense: d(20),
      tax: d(30),
    });

    expect(totals.grossProfit.toNumber()).toBe(600); // 1000 - 300 - 100
    expect(totals.operatingProfit.toNumber()).toBe(400); // 600 - 200
    expect(totals.netProfit.toNumber()).toBe(400); // 400 + 50 - 20 - 30
  });

  it("computes margin percentages relative to revenue", () => {
    const totals = derivePnlTotals({
      revenue: d(1000),
      directVariable: d(400),
      directFixed: d(0),
      indirect: d(0),
      otherIncome: d(0),
      otherExpense: d(0),
      tax: d(0),
    });
    expect(totals.grossMarginPct?.toNumber()).toBe(60);
    expect(totals.netMarginPct?.toNumber()).toBe(60);
  });

  it("returns null margins when there is no revenue (avoids division by zero)", () => {
    const totals = derivePnlTotals({
      revenue: d(0),
      directVariable: d(0),
      directFixed: d(0),
      indirect: d(0),
      otherIncome: d(0),
      otherExpense: d(0),
      tax: d(0),
    });
    expect(totals.grossMarginPct).toBeNull();
    expect(totals.netMarginPct).toBeNull();
  });

  it("allows net profit to go negative when costs exceed revenue", () => {
    const totals = derivePnlTotals({
      revenue: d(100),
      directVariable: d(50),
      directFixed: d(80),
      indirect: d(0),
      otherIncome: d(0),
      otherExpense: d(0),
      tax: d(0),
    });
    expect(totals.grossProfit.toNumber()).toBe(-30);
    expect(totals.netProfit.toNumber()).toBe(-30);
  });
});
