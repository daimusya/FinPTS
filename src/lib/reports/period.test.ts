import { describe, expect, it } from "vitest";
import { buildPeriod, periodMonths, periodQuery, previousPeriod, resolveReportPeriod } from "./period";

describe("report periods", () => {
  it("keeps the monthly period as before", () => {
    const p = resolveReportPeriod({ year: "2026", month: "9" });
    expect(p).toMatchObject({ year: 2026, month: 9, span: "month", label: "сентябрь 2026" });
    expect(p.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });

  it("builds a quarter from its number or from any month inside it", () => {
    const q = resolveReportPeriod({ year: "2026", span: "quarter", quarter: "3" });
    expect(q).toMatchObject({ month: 7, label: "3 квартал 2026" });
    expect(q.to.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    expect(resolveReportPeriod({ year: "2026", span: "quarter", month: "11" }).label).toBe("4 квартал 2026");
    expect(periodMonths(q)).toEqual([
      { year: 2026, month: 7 },
      { year: 2026, month: 8 },
      { year: 2026, month: 9 },
    ]);
  });

  it("builds a whole year", () => {
    const y = resolveReportPeriod({ year: "2026", span: "year", month: "5" });
    expect(y).toMatchObject({ month: 1, label: "2026 год" });
    expect(y.from.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(y.to.toISOString()).toBe("2026-12-31T23:59:59.999Z");
    expect(periodMonths(y)).toHaveLength(12);
  });

  it("steps back by the same length across year boundaries", () => {
    expect(previousPeriod(buildPeriod(2026, 1)).label).toBe("декабрь 2025");
    expect(previousPeriod(buildPeriod(2026, 2, "quarter")).label).toBe("4 квартал 2025");
    expect(previousPeriod(buildPeriod(2026, 1, "year")).label).toBe("2025 год");
  });

  it("round-trips through the URL query", () => {
    for (const p of [buildPeriod(2026, 9), buildPeriod(2026, 8, "quarter"), buildPeriod(2026, 1, "year")]) {
      const query = Object.fromEntries(new URLSearchParams(periodQuery(p)));
      expect(resolveReportPeriod(query).label).toBe(p.label);
    }
  });
});
