import { describe, expect, it } from "vitest";
import { hasPermission, type SessionPayload } from "./session";
import { PERMISSIONS } from "./permissions";

function session(permissions: string[]): SessionPayload {
  return { userId: "u1", email: "u1@example.com", fullName: "Test User", permissions };
}

describe("hasPermission", () => {
  it("allows an explicitly granted permission", () => {
    expect(hasPermission(session([PERMISSIONS.MASTERDATA_VIEW]), PERMISSIONS.MASTERDATA_VIEW)).toBe(true);
  });

  it("denies a permission that was not granted", () => {
    expect(hasPermission(session([PERMISSIONS.MASTERDATA_VIEW]), PERMISSIONS.PAYROLL_MANAGE)).toBe(false);
  });

  it("treats admin.full as a wildcard for every permission", () => {
    const admin = session([PERMISSIONS.ADMIN_FULL]);
    expect(hasPermission(admin, PERMISSIONS.PAYROLL_MANAGE)).toBe(true);
    expect(hasPermission(admin, PERMISSIONS.PERIODS_REOPEN)).toBe(true);
  });

  it("denies everything for a user with no roles", () => {
    expect(hasPermission(session([]), PERMISSIONS.REPORTS_VIEW)).toBe(false);
  });
});
