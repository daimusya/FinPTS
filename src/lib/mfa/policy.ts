import { PERMISSIONS } from "@/lib/permissions";

/** Кому вход с кодом из приложения обязателен: никому, администраторам или всем. */
export type MfaPolicy = "none" | "admins" | "all";

export const MFA_POLICY_LABELS: Record<MfaPolicy, string> = {
  none: "по желанию каждого",
  admins: "обязателен для администраторов (полный доступ или управление пользователями)",
  all: "обязателен для всех",
};

export function parseMfaPolicy(value: unknown): MfaPolicy {
  return value === "admins" || value === "all" ? value : "none";
}

/** Обязателен ли второй шаг этому пользователю — по его правам. Чистая функция. */
export function mfaRequiredFor(policy: MfaPolicy, permissions: readonly string[]): boolean {
  if (policy === "all") return true;
  if (policy === "admins") return permissions.includes(PERMISSIONS.ADMIN_FULL) || permissions.includes(PERMISSIONS.USERS_MANAGE);
  return false;
}
