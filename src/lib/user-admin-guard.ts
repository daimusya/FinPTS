import { PERMISSIONS } from "@/lib/permissions";

/**
 * Защита от «запирания» системы: после изменения пользователя или роли должен
 * остаться хотя бы один активный пользователь, который может управлять
 * пользователями (иначе выдать права и сбросить пароль будет некому).
 * Чистые функции — проверяются тестами; загрузка состояния — loadAdminState.
 */
export interface UserRoleState {
  id: string;
  isActive: boolean;
  roleIds: string[];
}

export interface RolePermissionState {
  id: string;
  codes: string[];
}

export const LOCKOUT_MESSAGE =
  "После этого изменения не останется ни одного активного пользователя с правом управлять пользователями — " +
  "выдать права или сбросить пароль будет некому. Сначала назначьте такое право другому сотруднику.";
export const SELF_DEACTIVATION_MESSAGE = "Нельзя отключить собственную учётную запись — это может сделать другой администратор";

export function grantsUserManagement(codes: readonly string[]): boolean {
  return codes.includes(PERMISSIONS.ADMIN_FULL) || codes.includes(PERMISSIONS.USERS_MANAGE);
}

export function countUserManagers(users: readonly UserRoleState[], roles: readonly RolePermissionState[]): number {
  const managerRoles = new Set(roles.filter((r) => grantsUserManagement(r.codes)).map((r) => r.id));
  return users.filter((u) => u.isActive && u.roleIds.some((id) => managerRoles.has(id))).length;
}

/** Проверка изменения пользователя (активность и роли); null — можно сохранять. */
export function userChangeProblem(input: {
  actorId: string;
  targetId: string;
  change: { isActive: boolean; roleIds: string[] };
  users: readonly UserRoleState[];
  roles: readonly RolePermissionState[];
}): string | null {
  if (input.actorId === input.targetId && !input.change.isActive) return SELF_DEACTIVATION_MESSAGE;
  const after = input.users.map((u) => (u.id === input.targetId ? { ...u, ...input.change } : u));
  return countUserManagers(after, input.roles) === 0 ? LOCKOUT_MESSAGE : null;
}

/** Проверка нового набора прав роли; null — можно сохранять. */
export function roleChangeProblem(input: {
  roleId: string;
  codes: string[];
  users: readonly UserRoleState[];
  roles: readonly RolePermissionState[];
}): string | null {
  const after = input.roles.map((r) => (r.id === input.roleId ? { ...r, codes: input.codes } : r));
  return countUserManagers(input.users, after) === 0 ? LOCKOUT_MESSAGE : null;
}
