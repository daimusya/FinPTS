import { describe, expect, it } from "vitest";
import {
  buildApprovalTimeline,
  isFinalStep,
  parseDecisionComment,
  roleForStep,
  selectApprovalRoute,
  totalSteps,
  type ApprovalRouteCandidate,
} from "./approval";

function route(overrides: Partial<ApprovalRouteCandidate> = {}): ApprovalRouteCandidate {
  return {
    id: "route1",
    priority: 100,
    minAmount: null,
    maxAmount: null,
    organizationId: null,
    steps: [
      { stepOrder: 1, roleId: "role-dept-head" },
      { stepOrder: 2, roleId: "role-fin-director" },
    ],
    ...overrides,
  };
}

describe("selectApprovalRoute", () => {
  it("returns null when no route is configured", () => {
    expect(selectApprovalRoute([], { amount: 1000, organizationId: "org1" })).toBeNull();
  });

  it("matches a route with no amount/organization restriction", () => {
    const r = route();
    expect(selectApprovalRoute([r], { amount: 1000, organizationId: "org1" })).toBe(r);
  });

  it("respects minAmount and maxAmount boundaries inclusively", () => {
    const r = route({ minAmount: 10000, maxAmount: 50000 });
    expect(selectApprovalRoute([r], { amount: 10000, organizationId: "org1" })).toBe(r);
    expect(selectApprovalRoute([r], { amount: 50000, organizationId: "org1" })).toBe(r);
    expect(selectApprovalRoute([r], { amount: 9999.99, organizationId: "org1" })).toBeNull();
    expect(selectApprovalRoute([r], { amount: 50000.01, organizationId: "org1" })).toBeNull();
  });

  it("only matches its own organization when organizationId is set", () => {
    const r = route({ organizationId: "org1" });
    expect(selectApprovalRoute([r], { amount: 1000, organizationId: "org1" })).toBe(r);
    expect(selectApprovalRoute([r], { amount: 1000, organizationId: "org2" })).toBeNull();
  });

  it("picks the lowest-priority matching route when several match", () => {
    const broad = route({ id: "broad", priority: 200 });
    const specific = route({ id: "specific", priority: 10, minAmount: 5000 });
    const result = selectApprovalRoute([broad, specific], { amount: 10000, organizationId: "org1" });
    expect(result?.id).toBe("specific");
  });

  it("skips non-matching routes and falls through to a matching one regardless of order", () => {
    const tooNarrow = route({ id: "narrow", organizationId: "org2" });
    const wide = route({ id: "wide" });
    expect(selectApprovalRoute([tooNarrow, wide], { amount: 1000, organizationId: "org1" })?.id).toBe("wide");
  });
});

describe("step helpers", () => {
  const r = route();

  it("totalSteps counts the route's steps", () => {
    expect(totalSteps(r)).toBe(2);
  });

  it("roleForStep looks up the role required at a given step", () => {
    expect(roleForStep(r, 1)).toBe("role-dept-head");
    expect(roleForStep(r, 2)).toBe("role-fin-director");
    expect(roleForStep(r, 3)).toBeNull();
  });

  it("isFinalStep is true only at or past the last step", () => {
    expect(isFinalStep(r, 1)).toBe(false);
    expect(isFinalStep(r, 2)).toBe(true);
  });
});

describe("parseDecisionComment", () => {
  it("makes the comment optional on approval and required on rejection", () => {
    expect(parseDecisionComment("approved", "  ")).toEqual({ comment: null });
    expect(parseDecisionComment("approved", " Согласовано, оплатить до пятницы ")).toEqual({ comment: "Согласовано, оплатить до пятницы" });
    expect(parseDecisionComment("rejected", "")).toHaveProperty("error", expect.stringContaining("причину"));
    expect(parseDecisionComment("rejected", "Нет договора")).toEqual({ comment: "Нет договора" });
  });

  it("limits the length", () => {
    expect(parseDecisionComment("approved", "а".repeat(1001))).toHaveProperty("error");
    expect(parseDecisionComment("approved", "а".repeat(1000))).toHaveProperty("comment");
  });
});

describe("buildApprovalTimeline", () => {
  const steps = [
    { stepOrder: 2, roleName: "Финансовый директор" },
    { stepOrder: 1, roleName: "Руководитель подразделения" },
    { stepOrder: 3, roleName: "Генеральный директор" },
  ];
  const decision = (stepOrder: number | null, value: string, minute: number, comment: string | null = null) => ({
    stepOrder,
    decision: value,
    approverName: `Согласующий ${minute}`,
    decidedAt: new Date(2026, 8, 28, 10, minute),
    comment,
  });

  it("shows decided, current and upcoming steps of a request in progress", () => {
    const t = buildApprovalTimeline({ steps, decisions: [decision(1, "approved", 5, "ок")], currentStep: 2, status: "PENDING_APPROVAL" });
    expect(t.map((e) => [e.stepOrder, e.state])).toEqual([
      [1, "approved"],
      [2, "current"],
      [3, "waiting"],
    ]);
    expect(t[0].decisions[0]).toMatchObject({ approverName: "Согласующий 5", comment: "ок" });
  });

  it("marks the steps after a rejection as not reached", () => {
    const t = buildApprovalTimeline({
      steps,
      decisions: [decision(2, "rejected", 9, "Нет договора"), decision(1, "approved", 5)],
      currentStep: 2,
      status: "REJECTED",
    });
    expect(t.map((e) => e.state)).toEqual(["approved", "rejected", "not_reached"]);
  });

  it("keeps decisions on steps that were later removed from the route", () => {
    const t = buildApprovalTimeline({
      steps: steps.slice(0, 2),
      decisions: [decision(1, "approved", 1), decision(2, "approved", 2), decision(3, "approved", 3)],
      currentStep: 3,
      status: "APPROVED",
    });
    expect(t.at(-1)).toMatchObject({ stepOrder: 3, state: "approved", removedFromRoute: true, roleName: null });
  });

  it("handles single-step approval without a route", () => {
    expect(buildApprovalTimeline({ steps: [], decisions: [], currentStep: 1, status: "PENDING_APPROVAL" })).toEqual([
      { stepOrder: null, roleName: null, state: "current", decisions: [], removedFromRoute: false },
    ]);
    const t = buildApprovalTimeline({ steps: [], decisions: [decision(null, "approved", 1, "Да")], currentStep: 1, status: "PAID" });
    expect(t[0]).toMatchObject({ state: "approved", decisions: [{ comment: "Да" }] });
    expect(buildApprovalTimeline({ steps: [], decisions: [], currentStep: 1, status: "CANCELLED" })[0].state).toBe("not_reached");
  });
});
