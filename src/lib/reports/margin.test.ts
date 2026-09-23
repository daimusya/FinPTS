import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { allocateIndirectCosts, computeBreakEven, computeMarginOfSafety } from "./margin";

function d(n: number) {
  return new Decimal(n);
}

describe("computeBreakEven", () => {
  it("computes break-even revenue from fixed costs and variable cost ratio", () => {
    // revenue 1000, variable cost 400 -> contribution margin ratio 0.6
    // fixed costs 300 -> break-even = 300 / 0.6 = 500
    const result = computeBreakEven(d(300), d(1000), d(400));
    expect(result?.toNumber()).toBe(500);
  });

  it("returns null when there is no revenue", () => {
    expect(computeBreakEven(d(100), d(0), d(0))).toBeNull();
  });

  it("returns null when variable costs consume the entire revenue or more (no contribution margin)", () => {
    expect(computeBreakEven(d(100), d(1000), d(1000))).toBeNull();
    expect(computeBreakEven(d(100), d(1000), d(1200))).toBeNull();
  });

  it("equals zero fixed costs -> break-even at zero revenue", () => {
    expect(computeBreakEven(d(0), d(1000), d(400))?.toNumber()).toBe(0);
  });
});

describe("computeMarginOfSafety", () => {
  it("computes the percentage revenue can drop before hitting break-even", () => {
    // revenue 1000, break-even 500 -> 50% margin of safety
    expect(computeMarginOfSafety(d(1000), d(500))?.toNumber()).toBe(50);
  });

  it("returns null when break-even is unreachable (null)", () => {
    expect(computeMarginOfSafety(d(1000), null)).toBeNull();
  });

  it("can be negative when current revenue is already below break-even", () => {
    expect(computeMarginOfSafety(d(400), d(500))?.toNumber()).toBe(-25);
  });
});

describe("allocateIndirectCosts", () => {
  it("returns an empty allocation for no rows", () => {
    expect(allocateIndirectCosts([], d(1000), "equal").size).toBe(0);
  });

  it("allocates zero to every row when total indirect is zero", () => {
    const rows = [{ key: "a", revenue: d(100), grossProfit: d(50) }];
    const result = allocateIndirectCosts(rows, d(0), "revenue");
    expect(result.get("a")?.toNumber()).toBe(0);
  });

  it("'equal' splits indirect costs evenly regardless of size", () => {
    const rows = [
      { key: "a", revenue: d(1000), grossProfit: d(500) },
      { key: "b", revenue: d(100), grossProfit: d(10) },
    ];
    const result = allocateIndirectCosts(rows, d(300), "equal");
    expect(result.get("a")?.toNumber()).toBe(150);
    expect(result.get("b")?.toNumber()).toBe(150);
  });

  it("'revenue' allocates proportionally to each row's revenue share", () => {
    const rows = [
      { key: "a", revenue: d(750), grossProfit: d(1) },
      { key: "b", revenue: d(250), grossProfit: d(1) },
    ];
    const result = allocateIndirectCosts(rows, d(400), "revenue");
    expect(result.get("a")?.toNumber()).toBe(300);
    expect(result.get("b")?.toNumber()).toBe(100);
  });

  it("'grossProfit' allocates proportionally to each row's gross profit share", () => {
    const rows = [
      { key: "a", revenue: d(1), grossProfit: d(300) },
      { key: "b", revenue: d(1), grossProfit: d(100) },
    ];
    const result = allocateIndirectCosts(rows, d(400), "grossProfit");
    expect(result.get("a")?.toNumber()).toBe(300);
    expect(result.get("b")?.toNumber()).toBe(100);
  });

  it("excludes negative/zero-weight rows from the proportional split (they still get zero, not a negative share)", () => {
    const rows = [
      { key: "profitable", revenue: d(1), grossProfit: d(200) },
      { key: "lossmaking", revenue: d(1), grossProfit: d(-50) },
    ];
    const result = allocateIndirectCosts(rows, d(100), "grossProfit");
    expect(result.get("profitable")?.toNumber()).toBe(100);
    expect(result.get("lossmaking")?.toNumber()).toBe(0);
  });

  it("falls back to an equal split when every row has zero weight, instead of silently dropping the cost", () => {
    const rows = [
      { key: "a", revenue: d(1), grossProfit: d(-100) },
      { key: "b", revenue: d(1), grossProfit: d(-50) },
    ];
    const result = allocateIndirectCosts(rows, d(200), "grossProfit");
    expect(result.get("a")?.toNumber()).toBe(100);
    expect(result.get("b")?.toNumber()).toBe(100);
  });
});
