import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import { computeProratedSalary, workingDays, type CalendarOverrides } from "./work-calendar";

// Same rows as the production_calendar_and_line_comment migration.
const HOLIDAYS = [
  "2025-01-01", "2025-01-02", "2025-01-03", "2025-01-06", "2025-01-07", "2025-01-08", "2025-02-24", "2025-03-10",
  "2025-05-01", "2025-05-02", "2025-05-09", "2025-06-12", "2025-11-03", "2025-11-04", "2025-12-31",
  "2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-02-23",
  "2026-03-09", "2026-05-01", "2026-05-11", "2026-06-12", "2026-11-04", "2026-12-31",
];
const calendar: CalendarOverrides = new Map([
  ...HOLIDAYS.map((d) => [d, "holiday"] as const),
  ["2025-11-01", "workday"] as const,
]);
const calendarYears = new Set([2025, 2026]);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const monthNorm = (y: number, m: number) => workingDays(utc(y, m, 1), new Date(Date.UTC(y, m, 0)), calendar).length;

const base = {
  salary: toDecimal(100000),
  year: 2026,
  month: 9,
  part: "full" as const,
  hireDate: utc(2020, 1, 1),
  terminationDate: null,
  calendar,
  calendarYears,
  timesheet: new Map<string, Set<string>>(),
};

describe("production calendar", () => {
  it("gives the official working-day norms", () => {
    expect(workingDays(utc(2025, 1, 1), utc(2025, 12, 31), calendar)).toHaveLength(247);
    expect(workingDays(utc(2026, 1, 1), utc(2026, 12, 31), calendar)).toHaveLength(247);
    expect(monthNorm(2026, 1)).toBe(15);
    expect(monthNorm(2026, 5)).toBe(19);
    expect(monthNorm(2026, 9)).toBe(22);
    expect(monthNorm(2025, 11)).toBe(19); // includes the working Saturday, 1 November
  });
});

describe("computeProratedSalary", () => {
  it("pays the full salary for a month without absences (empty timesheet)", () => {
    const r = computeProratedSalary(base);
    expect([r.normDays, r.workedDays, r.amount.toNumber()]).toEqual([22, 22, 100000]);
    expect(r.comment).toBe("Отработано 22 из 22 раб. дн. месяца");
  });

  it("deducts vacation working days; weekend vacation days change nothing", () => {
    const timesheet = new Map<string, Set<string>>();
    for (let d = 12; d <= 20; d++) timesheet.set(`2026-09-${String(d).padStart(2, "0")}`, new Set(["vacation"]));
    const r = computeProratedSalary({ ...base, timesheet });
    expect(r.absentByType).toEqual({ vacation: 5 }); // 14–18 September
    expect(r.workedDays).toBe(17);
    expect(r.amount.toNumber()).toBe(77272.73);
    expect(r.comment).toBe("Отработано 17 из 22 раб. дн. месяца (отпуск 5)");
  });

  it("counts a day as worked when it also has a work mark", () => {
    const timesheet = new Map([["2026-09-01", new Set(["absence", "work"])], ["2026-09-02", new Set(["absence"])]]);
    const r = computeProratedSalary({ ...base, timesheet });
    expect([r.workedDays, r.absentByType.absence]).toEqual([21, 1]);
  });

  it("does not pay days before hiring or after termination", () => {
    const hired = computeProratedSalary({ ...base, hireDate: utc(2026, 9, 16) });
    expect([hired.workedDays, hired.amount.toNumber()]).toEqual([11, 50000]);
    expect(hired.comment).toContain("не в штате часть периода");
    const left = computeProratedSalary({ ...base, terminationDate: utc(2026, 9, 4) });
    expect(left.workedDays).toBe(4);
  });

  it("computes the advance for days 1–15 against the month norm", () => {
    const r = computeProratedSalary({ ...base, part: "firstHalf" });
    expect([r.workedDays, r.amount.toNumber()]).toEqual([11, 50000]);
    const jan = computeProratedSalary({ ...base, month: 1, part: "firstHalf" });
    expect([jan.normDays, jan.workedDays, jan.amount.toNumber()]).toEqual([15, 4, 26666.67]); // 12–15 January
  });

  it("refuses a year without a production calendar", () => {
    expect(() => computeProratedSalary({ ...base, year: 2027 })).toThrow("2027");
  });
});
