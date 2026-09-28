import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import Decimal from "decimal.js";
import { computeExtraPay, computeProratedSalary, computeTripPay, isScheduledDay, monthWorkNorm, scheduledDays, toCalendarOverrides, workingDays, type CalendarOverrides, type WorkScheduleRule } from "./work-calendar";

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

// Shortened pre-holiday days (ст. 95 ТК РФ) — the same rows as the work_schedules_and_extra_pay migration.
const SHORT = ["2025-03-07", "2025-04-30", "2025-06-11", "2025-11-01", "2026-04-30", "2026-05-08", "2026-06-11", "2026-11-03"];
const withShort: CalendarOverrides = new Map([...calendar, ...SHORT.map((d) => [d, "short"] as const)]);
const five = { kind: "five_day", hoursPerDay: new Decimal(8) } as WorkScheduleRule;

describe("working-time norms with shortened days", () => {
  it("gives the official hour norms: 1972 in 2025 and in 2026", () => {
    const yearHours = (y: number) =>
      Array.from({ length: 12 }, (_, i) => monthWorkNorm(y, i + 1, five, withShort).hours).reduce((a, b) => a.plus(b), new Decimal(0));
    expect(yearHours(2025).toNumber()).toBe(1972);
    expect(yearHours(2026).toNumber()).toBe(1972);
    expect(monthWorkNorm(2026, 4, five, withShort)).toEqual({ days: 22, hours: new Decimal(175) });
    // A shortened working Saturday is still a working day.
    expect(monthWorkNorm(2025, 11, five, withShort).days).toBe(19);
  });

  it("maps calendar rows, keeping short days as working ones", () => {
    const overrides = toCalendarOverrides([
      { date: utc(2026, 4, 30), kind: "short" },
      { date: utc(2026, 5, 1), kind: "holiday" },
      { date: utc(2025, 11, 1), kind: "workday" },
    ]);
    expect([...overrides.values()]).toEqual(["short", "holiday", "workday"]);
  });
});

describe("shift schedule", () => {
  const shift: WorkScheduleRule = { kind: "shift", hoursPerDay: new Decimal(12), cycleOn: 2, cycleOff: 2, anchorDate: utc(2026, 9, 1) };

  it("plans shifts by the 2-on/2-off cycle regardless of weekends and holidays", () => {
    const sep = scheduledDays(utc(2026, 9, 1), utc(2026, 9, 30), shift, calendar);
    expect(sep).toHaveLength(16);
    expect(sep.slice(0, 4)).toEqual(["2026-09-01", "2026-09-02", "2026-09-05", "2026-09-06"]);
    expect(isScheduledDay(utc(2026, 8, 31), shift, calendar)).toBe(false);
    expect(isScheduledDay(utc(2026, 8, 30), shift, calendar)).toBe(false);
    expect(isScheduledDay(utc(2026, 8, 29), shift, calendar)).toBe(true);
    expect(monthWorkNorm(2026, 9, shift, calendar).hours.toNumber()).toBe(192);
  });

  it("pays the salary by worked shifts", () => {
    const r = computeProratedSalary({ ...base, salary: toDecimal(96000), schedule: shift, timesheet: new Map([["2026-09-05", new Set(["vacation"])]]) });
    expect(r).toMatchObject({ normDays: 16, workedDays: 15 });
    expect(r.amount.toNumber()).toBe(90000);
    expect(r.comment).toBe("Отработано 15 из 16 смен месяца (отпуск 1)");
  });
});

describe("computeExtraPay", () => {
  const hours = (entries: Array<[string, string, number]>) => {
    const map = new Map<string, Map<string, Decimal>>();
    for (const [day, type, h] of entries) map.set(day, (map.get(day) ?? new Map()).set(type, new Decimal(h)));
    return map;
  };
  const sep = { salary: toDecimal(176000), year: 2026, month: 9, schedule: five, calendar: withShort, hireDate: utc(2020, 1, 1), terminationDate: null };

  it("pays overtime: the first 2 hours of a day at 1.5, the rest at 2", () => {
    const r = computeExtraPay({ ...sep, hours: hours([["2026-09-10", "overtime", 3], ["2026-09-11", "overtime", 1]]), workedRegularHours: new Decimal(176) });
    expect(r.hourlyRate.toNumber()).toBe(1000);
    expect(r.overtime).toEqual({ days: 2, hours: new Decimal(4), amount: new Decimal(6500) });
    expect(r.weekend.amount.toNumber()).toBe(0);
  });

  it("pays weekend work single within the monthly norm and double beyond it", () => {
    const saturday = hours([["2026-09-12", "work", 0]]);
    const full = computeExtraPay({ ...sep, hours: saturday, workedRegularHours: new Decimal(176) });
    expect(full.weekend).toMatchObject({ days: 1, hours: new Decimal(8), withinNormHours: new Decimal(0), beyondNormHours: new Decimal(8) });
    expect(full.weekend.amount.toNumber()).toBe(16000);
    const afterVacationDay = computeExtraPay({ ...sep, hours: saturday, workedRegularHours: new Decimal(168) });
    expect(afterVacationDay.weekend.amount.toNumber()).toBe(8000);
  });

  it("pays a shift worker's scheduled holiday shift at least single on top of the salary", () => {
    const shift: WorkScheduleRule = { kind: "shift", hoursPerDay: new Decimal(12), cycleOn: 2, cycleOff: 2, anchorDate: utc(2026, 11, 3) };
    const r = computeExtraPay({
      salary: toDecimal(180000),
      year: 2026,
      month: 11,
      schedule: shift,
      calendar: withShort,
      hireDate: utc(2020, 1, 1),
      terminationDate: null,
      hours: new Map(),
      workedRegularHours: new Decimal(168),
    });
    expect(r.normHours.toNumber()).toBe(168);
    expect(r.weekend).toMatchObject({ days: 1, withinNormHours: new Decimal(12), beyondNormHours: new Decimal(0) });
    expect(r.weekend.amount.toNumber()).toBe(12857.14);
  });
});

describe("computeTripPay", () => {
  it("divides 12 months' earnings by the days actually worked", () => {
    expect(computeTripPay({ tripDays: 3, totalEarnings: toDecimal(1200000), workedDays: 240, salary: null, monthNormDays: 22 })).toEqual({
      avgDaily: new Decimal(5000),
      amount: new Decimal(15000),
      method: "average",
    });
  });

  it("falls back to the salary for a day of the trip month", () => {
    expect(computeTripPay({ tripDays: 2, totalEarnings: toDecimal(0), workedDays: 0, salary: toDecimal(110000), monthNormDays: 22 })).toMatchObject({
      avgDaily: new Decimal(5000),
      amount: new Decimal(10000),
      method: "salary",
    });
    expect(() => computeTripPay({ tripDays: 1, totalEarnings: toDecimal(0), workedDays: 0, salary: null, monthNormDays: 22 })).toThrow();
  });
});
