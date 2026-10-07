import { describe, expect, it } from "vitest";
import { firstUncoveredDay, fxCoverageProblem } from "./fx-coverage";

const weekdays = (from: string, to: string) => {
  const keys: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
};

describe("firstUncoveredDay", () => {
  it("weekday rates cover the whole month, weekends included", () => {
    expect(firstUncoveredDay(weekdays("2026-09-25", "2026-10-31"), "2026-10-01", "2026-10-31")).toBeNull();
  });
  it("a rate before the month counts for its first days", () => {
    expect(firstUncoveredDay(["2026-09-28", ...weekdays("2026-10-05", "2026-10-31")], "2026-10-01", "2026-10-31")).toBeNull();
  });
  it("finds where loading stopped", () => {
    expect(firstUncoveredDay(weekdays("2026-09-25", "2026-10-09"), "2026-10-01", "2026-10-31")).toBe("2026-10-20");
    expect(firstUncoveredDay([], "2026-10-01", "2026-10-31")).toBe("2026-10-01");
    expect(firstUncoveredDay(["2026-08-01"], "2026-10-01", "2026-10-31")).toBe("2026-10-01");
  });
});

describe("fxCoverageProblem", () => {
  it("names currencies and dates; null when all covered", () => {
    const ok = weekdays("2026-09-25", "2026-10-31");
    expect(fxCoverageProblem(new Map([["USD", ok]]), "2026-10-01", "2026-10-31")).toBeNull();
    expect(fxCoverageProblem(new Map([["USD", ok], ["EUR", weekdays("2026-09-25", "2026-10-09")]]), "2026-10-01", "2026-10-31")).toBe(
      "EUR: нет свежего курса ЦБ с 20.10.2026",
    );
  });
});
