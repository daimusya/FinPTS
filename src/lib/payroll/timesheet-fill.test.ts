import { describe, expect, it } from "vitest";
import { monthsTouched, parseTimesheetFill } from "./timesheet-fill";

const base = { employeeCount: 2, dateFrom: "2026-10-01", dateTo: "2026-10-31", dayType: "work", hours: "8" };

describe("parseTimesheetFill", () => {
  it("accepts a month of working days", () => {
    expect(parseTimesheetFill(base)).toEqual({
      dateFrom: new Date("2026-10-01T00:00:00Z"),
      dateTo: new Date("2026-10-31T00:00:00Z"),
      dayType: "work",
      hours: 8,
    });
    expect(parseTimesheetFill({ ...base, hours: "7,5" })).toMatchObject({ hours: 7.5 });
    expect(parseTimesheetFill({ ...base, dayType: "vacation", hours: "" })).toMatchObject({ hours: 0 });
  });

  it("explains what is wrong instead of silently doing nothing", () => {
    expect(parseTimesheetFill({ ...base, employeeCount: 0 })).toEqual({ error: "Отметьте хотя бы одного сотрудника" });
    expect(parseTimesheetFill({ ...base, dateTo: "" })).toEqual({ error: "Укажите даты «с» и «по»" });
    expect(parseTimesheetFill({ ...base, dateFrom: "2026-11-01" })).toEqual({ error: "Дата «по» раньше даты «с»" });
    expect(parseTimesheetFill({ ...base, dateFrom: "2025-01-01", dateTo: "2026-12-31" })).toEqual({ error: "За один раз — не больше года" });
    expect(parseTimesheetFill({ ...base, dayType: "party" })).toEqual({ error: "Выберите тип дня" });
    expect(parseTimesheetFill({ ...base, hours: "25" })).toEqual({ error: "Часов в день — от 0 до 24" });
    expect(parseTimesheetFill({ ...base, hours: "-1" })).toEqual({ error: "Часов в день — от 0 до 24" });
  });
});

describe("monthsTouched", () => {
  it("lists every month the period crosses", () => {
    expect(monthsTouched(new Date("2026-09-28T00:00:00Z"), new Date("2026-11-02T00:00:00Z")).map((d) => d.toISOString().slice(0, 7))).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(monthsTouched(new Date("2026-10-05T00:00:00Z"), new Date("2026-10-05T00:00:00Z"))).toHaveLength(1);
  });
});
