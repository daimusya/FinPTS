import { describe, expect, it } from "vitest";
import { ruleConditionsProblem } from "./rule-form";

const base = { direction: null, purposeContains: null, counterpartyInn: null, amountEquals: null };

describe("ruleConditionsProblem", () => {
  it("normalizes a valid amount and INN", () => {
    expect(ruleConditionsProblem({ ...base, amountEquals: "1 000,50", counterpartyInn: "7707 083893" })).toEqual({
      amountEquals: "1000.50",
      counterpartyInn: "7707083893",
    });
    expect(ruleConditionsProblem({ ...base, purposeContains: "аренда", direction: "OUTFLOW" })).toEqual({ amountEquals: null, counterpartyInn: null });
  });
  it("refuses conditions that break or never/always match", () => {
    expect(ruleConditionsProblem({ ...base, amountEquals: "abc" })).toMatchObject({ error: expect.stringMatching(/нужно число/) });
    expect(ruleConditionsProblem({ ...base, counterpartyInn: "77070838" })).toMatchObject({ error: expect.stringMatching(/^ИНН контрагента/) });
    expect(ruleConditionsProblem({ ...base, purposeContains: "а" })).toMatchObject({ error: expect.stringMatching(/не короче 3/) });
    expect(ruleConditionsProblem({ ...base, direction: "SIDEWAYS", purposeContains: "аренда" })).toEqual({ error: "Выберите направление из списка" });
  });
});
