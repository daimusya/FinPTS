import { describe, expect, it } from "vitest";
import { buildCalendarRows } from "./payment-calendar";

describe("buildCalendarRows", () => {
  it("carries a running balance forward across days", () => {
    const rows = buildCalendarRows(1000, [
      { date: new Date("2026-09-20"), amount: 500, direction: "INFLOW" },
      { date: new Date("2026-09-21"), amount: 300, direction: "OUTFLOW" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].balance.toNumber()).toBe(1500);
    expect(rows[1].balance.toNumber()).toBe(1200);
  });

  it("groups multiple movements on the same day", () => {
    const rows = buildCalendarRows(0, [
      { date: new Date("2026-09-20"), amount: 100, direction: "INFLOW" },
      { date: new Date("2026-09-20"), amount: 40, direction: "OUTFLOW" },
      { date: new Date("2026-09-20"), amount: 200, direction: "INFLOW" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].inflow.toNumber()).toBe(300);
    expect(rows[0].outflow.toNumber()).toBe(40);
    expect(rows[0].balance.toNumber()).toBe(260);
  });

  it("sorts days chronologically regardless of input order", () => {
    const rows = buildCalendarRows(0, [
      { date: new Date("2026-09-25"), amount: 10, direction: "INFLOW" },
      { date: new Date("2026-09-20"), amount: 5, direction: "INFLOW" },
    ]);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-20", "2026-09-25"]);
  });

  it("can go negative when outflows exceed the running balance", () => {
    const rows = buildCalendarRows(100, [{ date: new Date("2026-09-20"), amount: 400, direction: "OUTFLOW" }]);
    expect(rows[0].balance.toNumber()).toBe(-300);
  });
});
