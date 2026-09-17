import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeBreakEven, computeMarginOfSafety } from "./margin";

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
