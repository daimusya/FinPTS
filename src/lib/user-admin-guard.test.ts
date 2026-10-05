import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions";
import { LOCKOUT_MESSAGE, SELF_DEACTIVATION_MESSAGE, countUserManagers, roleChangeProblem, userChangeProblem } from "./user-admin-guard";

const roles = [
  { id: "admin", codes: [PERMISSIONS.ADMIN_FULL] },
  { id: "hr", codes: [PERMISSIONS.USERS_MANAGE, PERMISSIONS.PAYROLL_VIEW] },
  { id: "acc", codes: [PERMISSIONS.ACCRUALS_VIEW] },
];
const users = [
  { id: "boss", isActive: true, roleIds: ["admin"] },
  { id: "clerk", isActive: true, roleIds: ["acc"] },
  { id: "former", isActive: false, roleIds: ["admin"] },
];

describe("countUserManagers", () => {
  it("counts active users whose roles give full admin or user management", () => {
    expect(countUserManagers(users, roles)).toBe(1);
    expect(countUserManagers([...users, { id: "kadry", isActive: true, roleIds: ["acc", "hr"] }], roles)).toBe(2);
  });
});

describe("userChangeProblem", () => {
  it("does not let anyone switch off their own account", () => {
    expect(userChangeProblem({ actorId: "boss", targetId: "boss", change: { isActive: false, roleIds: ["admin"] }, users, roles })).toBe(
      SELF_DEACTIVATION_MESSAGE,
    );
  });

  it("refuses to take the last manager's role away, allows it while another manager remains", () => {
    const change = { isActive: true, roleIds: ["acc"] };
    expect(userChangeProblem({ actorId: "boss", targetId: "boss", change, users, roles })).toBe(LOCKOUT_MESSAGE);
    const withSecond = [...users, { id: "kadry", isActive: true, roleIds: ["hr"] }];
    expect(userChangeProblem({ actorId: "boss", targetId: "boss", change, users: withSecond, roles })).toBeNull();
    expect(userChangeProblem({ actorId: "kadry", targetId: "boss", change: { isActive: false, roleIds: ["admin"] }, users: withSecond, roles })).toBeNull();
  });

  it("ordinary edits of other users pass", () => {
    expect(userChangeProblem({ actorId: "boss", targetId: "clerk", change: { isActive: false, roleIds: [] }, users, roles })).toBeNull();
  });
});

describe("roleChangeProblem", () => {
  it("refuses to strip the only manager role of its rights", () => {
    expect(roleChangeProblem({ roleId: "admin", codes: [PERMISSIONS.ACCRUALS_VIEW], users, roles })).toBe(LOCKOUT_MESSAGE);
    expect(roleChangeProblem({ roleId: "admin", codes: [PERMISSIONS.USERS_MANAGE], users, roles })).toBeNull();
    expect(roleChangeProblem({ roleId: "acc", codes: [], users, roles })).toBeNull();
  });
});
