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

export const ADMIN_ONLY_MESSAGE = "Полный доступ администратора выдаёт, снимает и затрагивает только администратор";
export const OWN_ACCESS_MESSAGE = "Свои роли, права своей роли и свою область видимости меняет другой администратор";

/**
 * Защита от повышения своих прав тем, кто управляет пользователями, но не
 * администратор: он не выдаёт и не снимает полный доступ, не трогает учётные
 * записи администраторов (иначе сбросил бы пароль администратору и вошёл под
 * ним) и не меняет собственные роли. Администратор — без ограничений.
 */
export function userEscalationProblem(input: {
  actorIsAdmin: boolean;
  actorId: string;
  targetId: string | null;
  /** Роли пользователя сейчас (у нового — пусто). */
  rolesBefore: readonly string[];
  /** Роли после изменения; null — роли не меняются (сброс пароля, сеансы, область видимости). */
  rolesAfter: readonly string[] | null;
  roles: readonly RolePermissionState[];
  /** Меняется ли что-то, кроме ролей, что касается доступа самого пользователя (область видимости). */
  changesOwnAccess?: boolean;
}): string | null {
  if (input.actorIsAdmin) return null;
  const adminRoles = new Set(input.roles.filter((r) => r.codes.includes(PERMISSIONS.ADMIN_FULL)).map((r) => r.id));
  const isAdmin = (ids: readonly string[]) => ids.some((id) => adminRoles.has(id));
  if (isAdmin(input.rolesBefore) || (input.rolesAfter && isAdmin(input.rolesAfter))) return ADMIN_ONLY_MESSAGE;
  if (input.targetId === input.actorId) {
    const rolesChanged =
      input.rolesAfter !== null &&
      (input.rolesAfter.length !== input.rolesBefore.length || input.rolesAfter.some((id) => !input.rolesBefore.includes(id)));
    if (rolesChanged || input.changesOwnAccess) return OWN_ACCESS_MESSAGE;
  }
  return null;
}

/** То же для ролей: полный доступ в роль добавляет или убирает только администратор, права своей роли он не меняет. */
export function roleEscalationProblem(input: {
  actorIsAdmin: boolean;
  actorHoldsRole: boolean;
  codesBefore: readonly string[];
  codesAfter: readonly string[];
}): string | null {
  if (input.actorIsAdmin) return null;
  if (input.codesBefore.includes(PERMISSIONS.ADMIN_FULL) || input.codesAfter.includes(PERMISSIONS.ADMIN_FULL)) return ADMIN_ONLY_MESSAGE;
  const changed = input.codesAfter.length !== input.codesBefore.length || input.codesAfter.some((c) => !input.codesBefore.includes(c));
  if (input.actorHoldsRole && changed) return OWN_ACCESS_MESSAGE;
  return null;
}
