import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import { readScheduleRows, scheduleSummary, suggestSplit, validateSchedule } from "./parts";

describe("readScheduleRows", () => {
  it("pairs the parallel form fields and skips empty rows", () => {
    expect(readScheduleRows(["p1", "", ""], ["2026-10-05", "2026-10-12", ""], ["100", "50", ""])).toEqual([
      { id: "p1", dueDate: "2026-10-05", dueTime: "", amount: "100" },
      { id: null, dueDate: "2026-10-12", dueTime: "", amount: "50" },
    ]);
    expect(readScheduleRows([""], ["2026-10-05"], ["100"], ["10:30"])[0].dueTime).toBe("10:30");
  });
});

describe("validateSchedule", () => {
  const today = "2026-09-28";
  const row = (dueDate: string, amount: string, id: string | null = null) => ({ id, dueDate, amount });

  it("accepts parts summing to the request and sorts them by date", () => {
    const r = validateSchedule({ requestAmount: "1000", paidAmounts: [], rows: [row("2026-10-20", "400,5"), row("2026-10-05", "599.50")], todayKey: today });
    expect(r).toEqual({
      rows: [
        { id: null, dueDate: new Date("2026-10-05T00:00:00Z"), dueKey: "2026-10-05", dueTime: null, amount: "599.50" },
        { id: null, dueDate: new Date("2026-10-20T00:00:00Z"), dueKey: "2026-10-20", dueTime: null, amount: "400.50" },
      ],
    });
  });

  it("keeps the time of each part, orders a day's parts by time and rejects a bad time", () => {
    const timed = (dueDate: string, dueTime: string, amount: string) => ({ id: null, dueDate, dueTime, amount });
    const r = validateSchedule({
      requestAmount: "900",
      paidAmounts: [],
      rows: [timed("2026-10-05", "", "300"), timed("2026-10-05", "15:00", "300"), timed("2026-10-05", "9.30", "300")],
      todayKey: today,
    });
    expect("rows" in r && r.rows.map((x) => x.dueTime)).toEqual(["09:30", "15:00", null]);
    expect(
      validateSchedule({ requestAmount: "600", paidAmounts: [], rows: [timed("2026-10-05", "25:00", "300"), timed("2026-10-06", "", "300")], todayKey: today }),
    ).toEqual({ error: "Часть 1: время оплаты — в формате ЧЧ:ММ, например 10:30" });
  });

  it("counts already paid parts toward the total", () => {
    expect(validateSchedule({ requestAmount: "1000", paidAmounts: ["300"], rows: [row("2026-10-05", "700")], todayKey: today })).toHaveProperty("rows");
    expect(validateSchedule({ requestAmount: "1000", paidAmounts: ["300"], rows: [row("2026-10-05", "600")], todayKey: today })).toEqual({
      error: `Части в сумме меньше заявки на ${formatMoney(100)} — к оплате осталось ${formatMoney(700)}`,
    });
  });

  it("rejects a single part, past dates, bad amounts and an overshoot", () => {
    expect(validateSchedule({ requestAmount: "1000", paidAmounts: [], rows: [row("2026-10-05", "1000")], todayKey: today })).toHaveProperty(
      "error",
      expect.stringContaining("минимум две"),
    );
    expect(validateSchedule({ requestAmount: "1000", paidAmounts: [], rows: [row("2026-09-27", "500"), row("2026-10-05", "500")], todayKey: today })).toHaveProperty(
      "error",
      expect.stringContaining("Часть 1"),
    );
    expect(validateSchedule({ requestAmount: "1000", paidAmounts: [], rows: [row("2026-10-01", "0"), row("2026-10-05", "1000")], todayKey: today })).toHaveProperty(
      "error",
      expect.stringContaining("положительной"),
    );
    expect(validateSchedule({ requestAmount: "1000", paidAmounts: [], rows: [row("2026-10-01", "600"), row("2026-10-05", "500")], todayKey: today })).toEqual({
      error: `Части в сумме больше заявки на ${formatMoney(100)} — к оплате осталось ${formatMoney(1000)}`,
    });
  });
});

describe("scheduleSummary", () => {
  it("finds the next unpaid date and the paid / remaining amounts", () => {
    const s = scheduleSummary([
      { dueDate: new Date("2026-10-20"), amount: "400", paidAt: null },
      { dueDate: new Date("2026-10-05"), amount: "600", paidAt: new Date("2026-10-05") },
      { dueDate: new Date("2026-10-12"), amount: "100", paidAt: null },
    ]);
    expect(s).toMatchObject({ total: 3, paidCount: 1, nextDueDate: new Date("2026-10-12"), allPaid: false });
    expect(s.paidAmount.toFixed(2)).toBe("600.00");
    expect(s.remainingAmount.toFixed(2)).toBe("500.00");
    expect(scheduleSummary([{ dueDate: new Date("2026-10-05"), amount: "1", paidAt: new Date() }]).allPaid).toBe(true);
    expect(scheduleSummary([]).allPaid).toBe(false);
  });
});

describe("suggestSplit", () => {
  it("splits evenly with the remainder in the last part and weekly dates", () => {
    expect(suggestSplit("1000.00", "2026-10-30", 3)).toEqual([
      { id: null, dueDate: "2026-10-30", dueTime: "", amount: "333.33" },
      { id: null, dueDate: "2026-11-06", dueTime: "", amount: "333.33" },
      { id: null, dueDate: "2026-11-13", dueTime: "", amount: "333.34" },
    ]);
  });
});
