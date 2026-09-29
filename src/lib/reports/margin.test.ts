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

describe("margin plan", () => {
  it("plan totals from the P&L plan: gross and operating profit, margins and the break-even point", async () => {
    const { marginPlanTotals } = await import("./margin");
    const item = (group: string, amount: number) => ({ articleId: group, articleName: group, group, amount: new Decimal(amount) });
    const plan = marginPlanTotals([item("REVENUE", 1000000), item("DIRECT_VARIABLE", 400000), item("DIRECT_FIXED", 100000), item("INDIRECT", 200000), item("TAX", 50000)])!;
    expect([plan.grossProfit.toNumber(), plan.operatingProfit.toNumber()]).toEqual([500000, 300000]);
    expect(plan.grossMarginPct?.toNumber()).toBe(50);
    // Fixed 300 000 / contribution share 0,6 = 500 000; margin of safety 50 %.
    expect([plan.breakEvenRevenue?.toNumber(), plan.marginOfSafetyPct?.toNumber()]).toEqual([500000, 50]);
    expect(marginPlanTotals([item("TAX", 1)])).toBeNull();
  });

  it("puts each project's plan next to its fact and adds planned projects without a fact", async () => {
    const { mergeProjectPlan } = await import("./margin-plan");
    const z = new Decimal(0);
    const fact = [{ key: "a", label: "Альфа", revenue: new Decimal(100), directCost: new Decimal(40), grossProfit: new Decimal(60), grossMarginPct: null, allocatedIndirect: z, operatingProfit: z, operatingMarginPct: null }];
    const plan = new Map([
      ["a", { name: "Альфа", revenue: new Decimal(120), directCost: new Decimal(50) }],
      ["b", { name: "Бета", revenue: new Decimal(80), directCost: new Decimal(30) }],
    ]);
    const rows = mergeProjectPlan(fact, plan, null);
    expect(rows.map((r) => [r.key, r.revenue.toNumber(), r.plan?.grossProfit.toNumber()])).toEqual([
      ["a", 100, 70],
      ["b", 0, 50],
    ]);
    expect(mergeProjectPlan(fact, plan, "a").map((r) => r.key)).toEqual(["a"]);
    expect(mergeProjectPlan(fact, null, null)[0].plan).toBeNull();
  });
});
