import { describe, expect, it } from "vitest";
import { dimKey, parseDimKey, planLevelWarning, type BudgetSlice } from "./slice";

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
