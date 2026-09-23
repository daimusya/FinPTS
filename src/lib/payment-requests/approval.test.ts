import { describe, expect, it } from "vitest";
import { isFinalStep, roleForStep, selectApprovalRoute, totalSteps, type ApprovalRouteCandidate } from "./approval";

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
