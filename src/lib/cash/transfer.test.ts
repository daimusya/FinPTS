import { describe, expect, it } from "vitest";
import { oppositeDirection, resolveTransferAmounts, validateTransferAccounts } from "./transfer";

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

describe("resolveTransferAmounts", () => {
  it("uses one amount for accounts in the same currency and refuses a different second amount", () => {
    expect(resolveTransferAmounts({ amount: "1000", secondAmount: "", currency: "RUB", secondCurrency: "RUB" })).toEqual({ first: "1000.00", second: "1000.00", dealRate: null });
    expect(resolveTransferAmounts({ amount: "1000", secondAmount: "1 000,00", currency: "USD", secondCurrency: "USD" })).toHaveProperty("second", "1000.00");
    expect(resolveTransferAmounts({ amount: "1000", secondAmount: "990", currency: "RUB", secondCurrency: "RUB" })).toEqual({
      error: "У счетов одна валюта — суммы перевода должны совпадать. Комиссию банка внесите отдельной операцией",
    });
  });

  it("asks for the received amount when currencies differ and reports the deal rate in roubles", () => {
    expect(resolveTransferAmounts({ amount: "1000", secondAmount: "", currency: "USD", secondCurrency: "RUB" })).toEqual({
      error: "Счета в разных валютах (USD и RUB) — укажите сумму, поступившую на второй счёт, в RUB",
    });
    // Selling 1 000 $ for 84 000 ₽ and buying 1 000 $ for 85 000 ₽ — both at a rate in roubles per dollar.
    expect(resolveTransferAmounts({ amount: "1000", secondAmount: "84000", currency: "USD", secondCurrency: "RUB" })).toEqual({ first: "1000.00", second: "84000.00", dealRate: "84.0000" });
    expect(resolveTransferAmounts({ amount: "85000", secondAmount: "1000", currency: "RUB", secondCurrency: "USD" })).toEqual({ first: "85000.00", second: "1000.00", dealRate: "85.0000" });
    expect(resolveTransferAmounts({ amount: "-5", secondAmount: "1", currency: "RUB", secondCurrency: "USD" })).toHaveProperty("error");
  });
});
