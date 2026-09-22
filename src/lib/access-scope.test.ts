import { describe, expect, it } from "vitest";
import {
  accrualScopeWhere,
  bankTransactionScopeWhere,
  buildScope,
  departmentScopeWhere,
  employeeScopeWhere,
  isScopeRestricted,
  organizationScopeWhere,
  payrollRunScopeWhere,
  projectScopeWhere,
  UNRESTRICTED_SCOPE,
} from "./access-scope";

describe("buildScope", () => {
  it("leaves a dimension unrestricted (null) when no access rows exist for it", () => {
    const scope = buildScope([], [], []);
    expect(scope).toEqual(UNRESTRICTED_SCOPE);
  });

  it("restricts a dimension to the assigned IDs when access rows exist", () => {
    const scope = buildScope(["org1", "org2"], [], []);
    expect(scope.organizationIds).toEqual(["org1", "org2"]);
    expect(scope.departmentIds).toBeNull();
    expect(scope.projectIds).toBeNull();
  });

  it("restricts independently per dimension", () => {
    const scope = buildScope(["org1"], ["dept1", "dept2"], []);
    expect(scope.organizationIds).toEqual(["org1"]);
    expect(scope.departmentIds).toEqual(["dept1", "dept2"]);
    expect(scope.projectIds).toBeNull();
  });
});

describe("isScopeRestricted", () => {
  it("is false for a fully unrestricted scope", () => {
    expect(isScopeRestricted(UNRESTRICTED_SCOPE)).toBe(false);
  });

  it("is true when any single dimension is restricted", () => {
    expect(isScopeRestricted({ organizationIds: ["org1"], departmentIds: null, projectIds: null })).toBe(true);
    expect(isScopeRestricted({ organizationIds: null, departmentIds: [], projectIds: null })).toBe(true);
  });
});

describe("scope-where helpers", () => {
  it("return an empty where for an unrestricted scope", () => {
    expect(accrualScopeWhere(UNRESTRICTED_SCOPE)).toEqual({});
    expect(bankTransactionScopeWhere(UNRESTRICTED_SCOPE)).toEqual({});
    expect(employeeScopeWhere(UNRESTRICTED_SCOPE)).toEqual({});
    expect(payrollRunScopeWhere(UNRESTRICTED_SCOPE)).toEqual({});
    expect(organizationScopeWhere(UNRESTRICTED_SCOPE)).toEqual({});
    expect(departmentScopeWhere(UNRESTRICTED_SCOPE)).toEqual({});
    expect(projectScopeWhere(UNRESTRICTED_SCOPE)).toEqual({});
  });

  it("accrualScopeWhere / payrollRunScopeWhere / organizationScopeWhere filter by organizationId in", () => {
    const scope = { organizationIds: ["org1", "org2"], departmentIds: null, projectIds: null };
    expect(accrualScopeWhere(scope)).toEqual({ organizationId: { in: ["org1", "org2"] } });
    expect(payrollRunScopeWhere(scope)).toEqual({ organizationId: { in: ["org1", "org2"] } });
    expect(organizationScopeWhere(scope)).toEqual({ id: { in: ["org1", "org2"] } });
  });

  it("employeeScopeWhere combines organization and department restrictions with AND", () => {
    const scope = { organizationIds: ["org1"], departmentIds: ["dept1"], projectIds: null };
    expect(employeeScopeWhere(scope)).toEqual({
      AND: [{ organizationId: { in: ["org1"] } }, { departmentId: { in: ["dept1"] } }],
    });
    expect(employeeScopeWhere({ organizationIds: ["org1"], departmentIds: null, projectIds: null })).toEqual({
      AND: [{ organizationId: { in: ["org1"] } }],
    });
  });

  it("bankTransactionScopeWhere combines organization (via OR on account) with department/project", () => {
    const scope = { organizationIds: ["org1"], departmentIds: ["dept1"], projectIds: ["proj1"] };
    expect(bankTransactionScopeWhere(scope)).toEqual({
      AND: [
        {
          OR: [
            { bankAccount: { organizationId: { in: ["org1"] } } },
            { cashAccount: { organizationId: { in: ["org1"] } } },
          ],
        },
        { departmentId: { in: ["dept1"] } },
        { projectId: { in: ["proj1"] } },
      ],
    });
  });

  it("departmentScopeWhere / projectScopeWhere restrict by own id and parent organization", () => {
    const scope = { organizationIds: ["org1"], departmentIds: ["dept1"], projectIds: ["proj1"] };
    expect(departmentScopeWhere(scope)).toEqual({
      AND: [{ organizationId: { in: ["org1"] } }, { id: { in: ["dept1"] } }],
    });
    expect(projectScopeWhere(scope)).toEqual({
      AND: [{ organizationId: { in: ["org1"] } }, { id: { in: ["proj1"] } }],
    });
  });
});
