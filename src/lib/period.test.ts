import { describe, expect, it } from "vitest";
import { periodKeyForDate } from "./period";

describe("periodKeyForDate", () => {
  it("extracts UTC year and 1-based month from a date", () => {
    expect(periodKeyForDate(new Date(Date.UTC(2026, 8, 17)))).toEqual({ year: 2026, month: 9 });
  });

  it("handles December correctly (month index 11 -> month 12)", () => {
    expect(periodKeyForDate(new Date(Date.UTC(2025, 11, 31)))).toEqual({ year: 2025, month: 12 });
  });

  it("handles January correctly (month index 0 -> month 1)", () => {
    expect(periodKeyForDate(new Date(Date.UTC(2026, 0, 1)))).toEqual({ year: 2026, month: 1 });
  });
});
