import { describe, expect, it } from "vitest";
import { classifyTransaction, hasAnyCondition, ruleMatches, type ClassificationRuleInput } from "./classification";

function rule(overrides: Partial<ClassificationRuleInput> = {}): ClassificationRuleInput {
  return {
    id: "rule1",
    priority: 100,
    direction: null,
    purposeContains: null,
    counterpartyInn: null,
    amountEquals: null,
    cashFlowArticleId: "article1",
    departmentId: null,
    costCenterId: null,
    projectId: null,
    productServiceId: null,
    ...overrides,
  };
}

describe("hasAnyCondition", () => {
  it("is false when purpose, INN and amount are all unset", () => {
    expect(hasAnyCondition(rule())).toBe(false);
  });
  it("is true when any single condition is set", () => {
    expect(hasAnyCondition(rule({ purposeContains: "аренда" }))).toBe(true);
    expect(hasAnyCondition(rule({ counterpartyInn: "1234567890" }))).toBe(true);
    expect(hasAnyCondition(rule({ amountEquals: 100 }))).toBe(true);
  });
});

describe("ruleMatches", () => {
  it("never matches a rule with no real condition, even with direction set", () => {
    expect(ruleMatches(rule({ direction: "OUTFLOW" }), { direction: "OUTFLOW", purpose: "x", counterpartyInn: null, amount: 1 })).toBe(false);
  });

  it("matches purposeContains case-insensitively as a substring", () => {
    const r = rule({ purposeContains: "аренда офиса" });
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: "Оплата за АРЕНДА ОФИСА, сентябрь", counterpartyInn: null, amount: 50000 })).toBe(true);
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: "Прочее", counterpartyInn: null, amount: 50000 })).toBe(false);
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: null, counterpartyInn: null, amount: 50000 })).toBe(false);
  });

  it("matches counterpartyInn exactly", () => {
    const r = rule({ counterpartyInn: "7712345678" });
    expect(ruleMatches(r, { direction: "INFLOW", purpose: null, counterpartyInn: "7712345678", amount: 1 })).toBe(true);
    expect(ruleMatches(r, { direction: "INFLOW", purpose: null, counterpartyInn: "9999999999", amount: 1 })).toBe(false);
    expect(ruleMatches(r, { direction: "INFLOW", purpose: null, counterpartyInn: null, amount: 1 })).toBe(false);
  });

  it("matches amountEquals exactly regardless of representation", () => {
    const r = rule({ amountEquals: "1500.00" });
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: null, counterpartyInn: null, amount: 1500 })).toBe(true);
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: null, counterpartyInn: null, amount: 1500.01 })).toBe(false);
  });

  it("requires direction to match when the rule specifies one", () => {
    const r = rule({ direction: "OUTFLOW", purposeContains: "налог" });
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: "налог на прибыль", counterpartyInn: null, amount: 1 })).toBe(true);
    expect(ruleMatches(r, { direction: "INFLOW", purpose: "налог на прибыль", counterpartyInn: null, amount: 1 })).toBe(false);
  });

  it("requires ALL specified conditions to match (AND semantics)", () => {
    const r = rule({ purposeContains: "аренда", counterpartyInn: "7712345678" });
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: "аренда офиса", counterpartyInn: "7712345678", amount: 1 })).toBe(true);
    expect(ruleMatches(r, { direction: "OUTFLOW", purpose: "аренда офиса", counterpartyInn: "0000000000", amount: 1 })).toBe(false);
  });
});

describe("classifyTransaction", () => {
  const tx = { direction: "OUTFLOW" as const, purpose: "Аренда офиса за сентябрь", counterpartyInn: "7712345678", amount: 50000 };

  it("returns null when no rule matches", () => {
    expect(classifyTransaction([rule({ purposeContains: "зарплата" })], tx)).toBeNull();
  });

  it("returns the matching rule's assignments", () => {
    const r = rule({ purposeContains: "аренда", cashFlowArticleId: "art-rent", departmentId: "dept1" });
    const result = classifyTransaction([r], tx);
    expect(result).toEqual({
      ruleId: "rule1",
      cashFlowArticleId: "art-rent",
      departmentId: "dept1",
      costCenterId: null,
      projectId: null,
      productServiceId: null,
    });
  });

  it("picks the lowest-priority (first) match when multiple rules match", () => {
    const broad = rule({ id: "broad", priority: 200, purposeContains: "аренда", cashFlowArticleId: "art-broad" });
    const specific = rule({ id: "specific", priority: 10, purposeContains: "аренда", counterpartyInn: "7712345678", cashFlowArticleId: "art-specific" });
    const result = classifyTransaction([broad, specific], tx);
    expect(result?.ruleId).toBe("specific");
    expect(result?.cashFlowArticleId).toBe("art-specific");
  });
});
