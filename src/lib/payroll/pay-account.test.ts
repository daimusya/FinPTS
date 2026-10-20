import { describe, expect, it } from "vitest";
import { luhnValid, maskPayAccount, parsePayAccount } from "./pay-account";

describe("parsePayAccount", () => {
  it("an account of 20 digits or a card with a valid check digit; spaces and dashes are dropped", () => {
    expect(parsePayAccount("4081 7810 0000 0000 0001")).toEqual({ value: "40817810000000000001" });
    expect(parsePayAccount("4111-1111-1111-1111")).toEqual({ value: "4111111111111111" });
    expect(parsePayAccount("  ")).toEqual({ value: null });
  });
  it("letters, wrong length or a mistyped card number are refused", () => {
    expect(parsePayAccount("Сбербанк 4081781")).toHaveProperty("error");
    expect(parsePayAccount("408178100000000000")).toHaveProperty("error");
    expect(parsePayAccount("4111111111111112")).toHaveProperty("error");
  });
});

describe("luhnValid / maskPayAccount", () => {
  it("checks the card digit and masks all but the last four", () => {
    expect(luhnValid("2200000000000004")).toBe(true);
    expect(luhnValid("2200000000000005")).toBe(false);
    expect(maskPayAccount("40817810000000000001")).toBe("счёт …0001");
    expect(maskPayAccount("4111111111111111")).toBe("карта …1111");
    expect(maskPayAccount(null)).toBe("не указан");
  });
});
