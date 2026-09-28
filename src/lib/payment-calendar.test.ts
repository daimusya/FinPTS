import { describe, expect, it } from "vitest";
import {
  accountKey,
  adjacentMonths,
  buildCalendarRows,
  buildMonthGrid,
  itemScope,
  localDateKey,
  parseAccountKey,
  parseRescheduleDate,
  requestPlacement,
  type CalendarMovement,
} from "./payment-calendar";

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

describe("requestPlacement", () => {
  it("hides cancelled requests and shows everything else", () => {
    expect(requestPlacement("CANCELLED", true).visible).toBe(false);
    for (const status of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "PAID"]) {
      expect(requestPlacement(status, true).visible).toBe(true);
    }
  });

  it("counts approved always and pending only when asked; paid and rejected never move", () => {
    expect(requestPlacement("APPROVED", false)).toEqual({ visible: true, counted: true, movable: true });
    expect(requestPlacement("PENDING_APPROVAL", true)).toEqual({ visible: true, counted: true, movable: true });
    expect(requestPlacement("PENDING_APPROVAL", false)).toEqual({ visible: true, counted: false, movable: true });
    expect(requestPlacement("PAID", true)).toEqual({ visible: true, counted: false, movable: false });
    expect(requestPlacement("REJECTED", true)).toEqual({ visible: true, counted: false, movable: false });
  });
});

describe("parseRescheduleDate", () => {
  it("accepts today and later, rejects the past and impossible dates", () => {
    expect(parseRescheduleDate("2026-09-28", "2026-09-28")).toMatchObject({ key: "2026-09-28" });
    expect(parseRescheduleDate("2026-10-05", "2026-09-28")).toMatchObject({ key: "2026-10-05", date: new Date("2026-10-05T00:00:00Z") });
    expect(parseRescheduleDate("2026-09-27", "2026-09-28")).toHaveProperty("error", expect.stringContaining("прошлое"));
    expect(parseRescheduleDate("2026-02-30", "2026-01-01")).toHaveProperty("error");
    expect(parseRescheduleDate("05.10.2026", "2026-09-28")).toHaveProperty("error");
  });
});

describe("localDateKey and adjacentMonths", () => {
  it("formats the local date and steps across years", () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(adjacentMonths("2026-01")).toEqual({ prev: "2025-12", next: "2026-02" });
    expect(adjacentMonths("2026-12")).toEqual({ prev: "2026-11", next: "2027-01" });
  });
});

describe("buildMonthGrid", () => {
  const out = (date: string, amount: number): CalendarMovement => ({ date: new Date(date), amount, direction: "OUTFLOW", source: "request" });
  const inc = (date: string, amount: number): CalendarMovement => ({ date: new Date(date), amount, direction: "INFLOW", source: "document" });
  const holidays = new Map([["2026-11-04", { kind: "holiday" as const, name: "День народного единства" }]]);

  it("lays out full Monday-first weeks around the month", () => {
    const weeks = buildMonthGrid({ month: "2026-09", todayKey: "2026-09-28", startingBalance: 0, movements: [], calendar: new Map() });
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0]).toMatchObject({ date: "2026-08-31", inMonth: false });
    expect(weeks[4][6]).toMatchObject({ date: "2026-10-04", inMonth: false });
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
  });

  it("runs the balance from today, moves overdue items to today and leaves past days without a forecast", () => {
    const weeks = buildMonthGrid({
      month: "2026-09",
      todayKey: "2026-09-28",
      startingBalance: 1000,
      movements: [out("2026-09-10", 300), inc("2026-09-29", 500), out("2026-09-30", 2000)],
      calendar: new Map(),
    });
    const day = (key: string) => weeks.flat().find((d) => d.date === key)!;
    expect(day("2026-09-10")).toMatchObject({ isPast: true, balance: null });
    expect(day("2026-09-10").outflow.toNumber()).toBe(0);
    expect(day("2026-09-28").outflow.toNumber()).toBe(300);
    expect(day("2026-09-28").balance!.toNumber()).toBe(700);
    expect(day("2026-09-29").balance!.toNumber()).toBe(1200);
    expect(day("2026-09-30").balance!.toNumber()).toBe(-800);
    expect(day("2026-10-01").balance!.toNumber()).toBe(-800);
  });

  it("carries movements due before a future month into its opening balance and marks holidays", () => {
    const weeks = buildMonthGrid({
      month: "2026-11",
      todayKey: "2026-09-28",
      startingBalance: 1000,
      movements: [out("2026-10-15", 400), out("2026-11-04", 100)],
      calendar: holidays,
    });
    const day = (key: string) => weeks.flat().find((d) => d.date === key)!;
    expect(weeks[0][0].date).toBe("2026-10-26");
    expect(day("2026-11-03").balance!.toNumber()).toBe(600);
    expect(day("2026-11-04")).toMatchObject({ isWorking: false, holidayName: "День народного единства" });
    expect(day("2026-11-04").balance!.toNumber()).toBe(500);
    expect(day("2026-11-07").isWorking).toBe(false);
  });
});

describe("account keys and forecast scope", () => {
  it("round-trips account keys and rejects junk", () => {
    expect(accountKey("b1", null)).toBe("bank:b1");
    expect(accountKey(null, "c1")).toBe("cash:c1");
    expect(accountKey(null, null)).toBeNull();
    expect(parseAccountKey("bank:b1")).toEqual({ bankAccountId: "b1", cashAccountId: null });
    expect(parseAccountKey("cash:c1")).toEqual({ bankAccountId: null, cashAccountId: "c1" });
    expect(parseAccountKey("card:x")).toBeNull();
    expect(parseAccountKey("")).toBeNull();
  });

  it("filters by organization or by account, keeping the organization's unassigned payments apart", () => {
    const all = { organizationId: null, accountKey: null, accountOrganizationId: null };
    const org = { organizationId: "o1", accountKey: null, accountOrganizationId: null };
    const acc = { organizationId: null, accountKey: "bank:b1", accountOrganizationId: "o1" };
    const item = (organizationId: string, key: string | null) => ({ organizationId, accountKey: key });
    expect(itemScope(item("o2", null), all)).toBe("in");
    expect(itemScope(item("o1", "bank:b2"), org)).toBe("in");
    expect(itemScope(item("o2", null), org)).toBe("out");
    expect(itemScope(item("o1", "bank:b1"), acc)).toBe("in");
    expect(itemScope(item("o1", null), acc)).toBe("unassigned");
    expect(itemScope(item("o1", "cash:c1"), acc)).toBe("out");
    expect(itemScope(item("o2", null), acc)).toBe("out");
  });
});
