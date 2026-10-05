import { prisma } from "@/lib/db";
import type { RolePermissionState, UserRoleState } from "@/lib/user-admin-guard";

/** Текущие пользователи с ролями и роли с правами — для проверок user-admin-guard. */
export async function loadAdminState(): Promise<{ users: UserRoleState[]; roles: RolePermissionState[] }> {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({ select: { id: true, isActive: true, roles: { select: { roleId: true } } } }),
    prisma.role.findMany({ select: { id: true, permissions: { select: { permission: { select: { code: true } } } } } }),
  ]);
  return {
    users: users.map((u) => ({ id: u.id, isActive: u.isActive, roleIds: u.roles.map((r) => r.roleId) })),
    roles: roles.map((r) => ({ id: r.id, codes: r.permissions.map((p) => p.permission.code) })),
  };
}
