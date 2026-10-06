import { describe, expect, it } from "vitest";
import { payrollEmployeeWhere, payrollEmployeesSince, payrollWorkMonth, runLinesEditable } from "./run-month";

describe("payrollWorkMonth", () => {
  it("the final settlement pays for the previous month, the advance for its own", () => {
    expect(payrollWorkMonth("FINAL", new Date("2026-10-10T00:00:00Z"))).toEqual({
      year: 2026,
      month: 9,
      start: new Date("2026-09-01T00:00:00Z"),
      end: new Date("2026-09-30T00:00:00Z"),
    });
    expect(payrollWorkMonth("ADVANCE", new Date("2026-10-25T00:00:00Z"))).toMatchObject({ year: 2026, month: 10 });
    expect(payrollWorkMonth("FINAL", new Date("2027-01-10T00:00:00Z"))).toMatchObject({ year: 2026, month: 12 });
  });
});

describe("payrollEmployeeWhere", () => {
  it("includes employees dismissed during or after the work month", () => {
    const start = new Date("2026-09-01T00:00:00Z");
    expect(payrollEmployeeWhere("org", start)).toEqual({ organizationId: "org", OR: [{ status: "ACTIVE" }, { terminationDate: { gte: start } }] });
  });
});

describe("payrollEmployeesSince", () => {
  it("advance — only those still employed on the payout date; final — the whole work month", () => {
    expect(payrollEmployeesSince("ADVANCE", new Date("2026-09-25T00:00:00Z"))).toEqual(new Date("2026-09-25T00:00:00Z"));
    expect(payrollEmployeesSince("FINAL", new Date("2026-10-10T00:00:00Z"))).toEqual(new Date("2026-09-01T00:00:00Z"));
  });
});

describe("runLinesEditable", () => {
  it("only draft and calculated runs take line changes", () => {
    expect(runLinesEditable("DRAFT")).toBe(true);
    expect(runLinesEditable("CALCULATED")).toBe(true);
    expect(runLinesEditable("APPROVED")).toBe(false);
    expect(runLinesEditable("PAID")).toBe(false);
  });
});
