import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions";
import {
  ADMIN_ONLY_MESSAGE,
  LOCKOUT_MESSAGE,
  OWN_ACCESS_MESSAGE,
  SELF_DEACTIVATION_MESSAGE,
  countUserManagers,
  roleChangeProblem,
  roleEscalationProblem,
  userChangeProblem,
  userEscalationProblem,
} from "./user-admin-guard";

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

describe("userEscalationProblem / roleEscalationProblem", () => {
  const roles = [
    { id: "admin", codes: [PERMISSIONS.ADMIN_FULL] },
    { id: "hr", codes: [PERMISSIONS.USERS_MANAGE] },
    { id: "fd", codes: [PERMISSIONS.PAYMENT_REQUEST_APPROVE] },
  ];
  const base = { actorIsAdmin: false, actorId: "me", roles };
  it("a user manager without full access cannot grant, remove or touch full access", () => {
    expect(userEscalationProblem({ ...base, targetId: null, rolesBefore: [], rolesAfter: ["admin"] })).toBe(ADMIN_ONLY_MESSAGE);
    expect(userEscalationProblem({ ...base, targetId: "boss", rolesBefore: ["admin"], rolesAfter: ["admin", "fd"] })).toBe(ADMIN_ONLY_MESSAGE);
    // Resetting an administrator's password would let them sign in as the administrator.
    expect(userEscalationProblem({ ...base, targetId: "boss", rolesBefore: ["admin"], rolesAfter: null })).toBe(ADMIN_ONLY_MESSAGE);
  });
  it("nor change their own roles or access scope; others' ordinary roles are fine", () => {
    expect(userEscalationProblem({ ...base, targetId: "me", rolesBefore: ["hr"], rolesAfter: ["hr", "fd"] })).toBe(OWN_ACCESS_MESSAGE);
    expect(userEscalationProblem({ ...base, targetId: "me", rolesBefore: ["hr"], rolesAfter: null, changesOwnAccess: true })).toBe(OWN_ACCESS_MESSAGE);
    expect(userEscalationProblem({ ...base, targetId: "me", rolesBefore: ["hr"], rolesAfter: ["hr"] })).toBeNull();
    expect(userEscalationProblem({ ...base, targetId: "x", rolesBefore: [], rolesAfter: ["fd"] })).toBeNull();
    expect(userEscalationProblem({ ...base, actorIsAdmin: true, targetId: "me", rolesBefore: ["admin"], rolesAfter: ["admin", "fd"] })).toBeNull();
  });
  it("roles: full access only by an administrator, not one's own role", () => {
    const r = { actorIsAdmin: false, actorHoldsRole: false };
    expect(roleEscalationProblem({ ...r, codesBefore: [], codesAfter: [PERMISSIONS.ADMIN_FULL] })).toBe(ADMIN_ONLY_MESSAGE);
    expect(roleEscalationProblem({ ...r, codesBefore: [PERMISSIONS.ADMIN_FULL], codesAfter: [] })).toBe(ADMIN_ONLY_MESSAGE);
    expect(roleEscalationProblem({ ...r, actorHoldsRole: true, codesBefore: [PERMISSIONS.USERS_MANAGE], codesAfter: [PERMISSIONS.USERS_MANAGE, PERMISSIONS.CASH_MANAGE] })).toBe(OWN_ACCESS_MESSAGE);
    expect(roleEscalationProblem({ ...r, codesBefore: [], codesAfter: [PERMISSIONS.CASH_MANAGE] })).toBeNull();
    expect(roleEscalationProblem({ actorIsAdmin: true, actorHoldsRole: true, codesBefore: [], codesAfter: [PERMISSIONS.ADMIN_FULL] })).toBeNull();
  });
});
