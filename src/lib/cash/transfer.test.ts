import { describe, expect, it } from "vitest";
import { oppositeDirection, validateTransferAccounts } from "./transfer";

describe("oppositeDirection", () => {
  it("flips INFLOW to OUTFLOW and back", () => {
    expect(oppositeDirection("INFLOW")).toBe("OUTFLOW");
    expect(oppositeDirection("OUTFLOW")).toBe("INFLOW");
  });
});

describe("validateTransferAccounts", () => {
  it("requires exactly one second account", () => {
    const primary = { bankAccountId: "b1", cashAccountId: null };
    expect(validateTransferAccounts(primary, { bankAccountId: null, cashAccountId: null })).toMatch(/выберите/i);
    expect(validateTransferAccounts(primary, { bankAccountId: "b2", cashAccountId: "c1" })).toMatch(/выберите/i);
  });

  it("rejects a second account identical to the primary", () => {
    const primary = { bankAccountId: "b1", cashAccountId: null };
    expect(validateTransferAccounts(primary, { bankAccountId: "b1", cashAccountId: null })).toMatch(/отличаться/i);
  });

  it("accepts a valid distinct second account (bank or cash)", () => {
    const primary = { bankAccountId: "b1", cashAccountId: null };
    expect(validateTransferAccounts(primary, { bankAccountId: "b2", cashAccountId: null })).toBeNull();
    expect(validateTransferAccounts(primary, { bankAccountId: null, cashAccountId: "c1" })).toBeNull();
  });
});
