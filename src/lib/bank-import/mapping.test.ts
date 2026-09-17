import { describe, expect, it } from "vitest";
import { extractRow, type ColumnMapping } from "./mapping";

describe("extractRow", () => {
  it("parses a Russian dd.mm.yyyy date", () => {
    const mapping: ColumnMapping = { 0: "date" };
    const result = extractRow(["17.09.2026"], mapping);
    expect(result.date?.getUTCFullYear()).toBe(2026);
    expect(result.date?.getUTCMonth()).toBe(8);
    expect(result.date?.getUTCDate()).toBe(17);
  });

  it("derives direction from a signed amount column", () => {
    const mapping: ColumnMapping = { 0: "amount" };
    expect(extractRow(["1500.50"], mapping)).toMatchObject({ amount: 1500.5, direction: "INFLOW" });
    expect(extractRow(["-2000"], mapping)).toMatchObject({ amount: 2000, direction: "OUTFLOW" });
  });

  it("derives direction from separate credit/debit columns", () => {
    const mapping: ColumnMapping = { 0: "creditAmount", 1: "debitAmount" };
    expect(extractRow(["1000", null], mapping)).toMatchObject({ amount: 1000, direction: "INFLOW" });
    expect(extractRow([null, "500"], mapping)).toMatchObject({ amount: 500, direction: "OUTFLOW" });
    expect(extractRow([null, null], mapping)).toMatchObject({ amount: null, direction: null });
  });

  it("handles a comma decimal separator and currency noise", () => {
    const mapping: ColumnMapping = { 0: "amount" };
    expect(extractRow(["1 234,56 ₽"], mapping)).toMatchObject({ amount: 1234.56, direction: "INFLOW" });
  });

  it("strips non-digits from the INN column", () => {
    const mapping: ColumnMapping = { 0: "counterpartyInn" };
    expect(extractRow(["ИНН 7700000000"], mapping).counterpartyInn).toBe("7700000000");
  });

  it("ignores unmapped columns", () => {
    const mapping: ColumnMapping = { 0: "ignore" };
    const result = extractRow(["whatever"], mapping);
    expect(result.date).toBeNull();
    expect(result.amount).toBeNull();
  });
});
