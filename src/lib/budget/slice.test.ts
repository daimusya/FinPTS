import { describe, expect, it } from "vitest";
import { budgetSliceProblem, defaultSliceDims, dimKey, parseDimKey, planLevelWarning, type BudgetSlice } from "./slice";

const s = (over: Partial<BudgetSlice> = {}): BudgetSlice => ({ organizationId: null, departmentId: null, costCenterId: null, projectId: null, ...over });

describe("dimension keys", () => {
  it("round-trips and rejects junk", () => {
    expect(parseDimKey("")).toEqual({ departmentId: null, costCenterId: null, projectId: null });
    expect(parseDimKey("prj:p1")).toEqual({ departmentId: null, costCenterId: null, projectId: "p1" });
    expect(dimKey(parseDimKey("cc:c1")!)).toBe("cc:c1");
    expect(parseDimKey("org:x")).toBeNull();
  });
});

describe("planLevelWarning", () => {
  it("is quiet for a single level", () => {
    expect(planLevelWarning([s()])).toBeNull();
    expect(planLevelWarning([s({ organizationId: "o1" }), s({ organizationId: "o2" })])).toBeNull();
    expect(planLevelWarning([s({ departmentId: "d1" }), s({ departmentId: "d2", organizationId: "o1" })])).toBeNull();
  });

  it("warns when levels would be added up twice", () => {
    expect(planLevelWarning([s(), s({ organizationId: "o1" })])).toContain("по компании в целом и по организациям");
    expect(planLevelWarning([s({ organizationId: "o1" }), s({ departmentId: "d1" })])).toContain("без разреза и по подразделениям");
    expect(planLevelWarning([s({ departmentId: "d1" }), s({ projectId: "p1" })])).toContain("по подразделениям и по проектам");
  });
});

describe("budgetSliceProblem", () => {
  const slice = (s: Partial<BudgetSlice>): BudgetSlice => ({ organizationId: "org", departmentId: null, costCenterId: null, projectId: null, ...s });
  const free = { organizationIds: null, departmentIds: null, projectIds: null };
  it("unrestricted users see every slice", () => {
    expect(budgetSliceProblem(free, slice({ organizationId: null }))).toBeNull();
    expect(budgetSliceProblem(free, slice({ costCenterId: "cc" }))).toBeNull();
  });
  it("organization limits close the company plan and other organizations", () => {
    const scope = { ...free, organizationIds: ["org"] };
    expect(budgetSliceProblem(scope, slice({}))).toBeNull();
    expect(budgetSliceProblem(scope, slice({ organizationId: null }))).toMatch(/организации/);
    expect(budgetSliceProblem(scope, slice({ organizationId: "other" }))).toMatch(/организации/);
  });
  it("department or project limits allow only their own slices", () => {
    const scope = { ...free, departmentIds: ["d1"] };
    expect(budgetSliceProblem(scope, slice({ departmentId: "d1" }))).toBeNull();
    expect(budgetSliceProblem(scope, slice({ departmentId: "d2" }))).toBe("Доступны только планы ваших подразделений");
    expect(budgetSliceProblem(scope, slice({}))).toMatch(/подразделений/);
    expect(budgetSliceProblem(scope, slice({ costCenterId: "cc" }))).toMatch(/подразделений/);
    const both = { ...free, departmentIds: ["d1"], projectIds: ["p1"] };
    expect(budgetSliceProblem(both, slice({ projectId: "p1" }))).toBeNull();
    expect(budgetSliceProblem(both, slice({ projectId: "p2" }))).toBe("Доступны только планы ваших подразделений и проектов");
  });
  it("the page opens on the first own slice", () => {
    expect(defaultSliceDims({ ...free, departmentIds: ["d1", "d2"] })).toEqual({ departmentId: "d1", costCenterId: null, projectId: null });
    expect(defaultSliceDims({ ...free, projectIds: ["p1"] })).toEqual({ departmentId: null, costCenterId: null, projectId: "p1" });
    expect(defaultSliceDims(free)).toEqual({ departmentId: null, costCenterId: null, projectId: null });
  });
});
