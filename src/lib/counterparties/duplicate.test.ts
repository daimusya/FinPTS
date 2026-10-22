import { describe, expect, it } from "vitest";
import { sameCounterpartyKey } from "./duplicate";

describe("sameCounterpartyKey", () => {
  it("the same INN and KPP — one counterparty (spaces ignored, no KPP for sole traders)", () => {
    expect(sameCounterpartyKey({ inn: "7707083893", kpp: "773601001" }, { inn: "7707 083893", kpp: "773601001" })).toBe(true);
    expect(sameCounterpartyKey({ inn: "500100732259", kpp: null }, { inn: "500100732259", kpp: "" })).toBe(true);
  });
  it("a branch with another KPP, another INN or no INN at all — different", () => {
    expect(sameCounterpartyKey({ inn: "7707083893", kpp: "773601001" }, { inn: "7707083893", kpp: "784243001" })).toBe(false);
    expect(sameCounterpartyKey({ inn: "7707083893", kpp: null }, { inn: "7736050003", kpp: null })).toBe(false);
    expect(sameCounterpartyKey({ inn: null, kpp: null }, { inn: "", kpp: null })).toBe(false);
  });
});
