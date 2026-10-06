import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

/**
 * Какое право нужно, чтобы видеть отчёт, — выгрузка в Excel требует его
 * вместе с «Экспортом отчётов». Иначе право на экспорт открывало бы данные,
 * которых у пользователя на экране нет (например, зарплаты сотрудников).
 * Неизвестный вид отчёта — null.
 */
const VIEW_PERMISSION: Record<string, PermissionCode> = {
  "cash-flow": PERMISSIONS.REPORTS_VIEW,
  pnl: PERMISSIONS.REPORTS_VIEW,
  margin: PERMISSIONS.REPORTS_VIEW,
  debts: PERMISSIONS.REPORTS_VIEW,
  balance: PERMISSIONS.REPORTS_VIEW,
  "payroll-summary": PERMISSIONS.PAYROLL_VIEW,
  "scenario-forecast": PERMISSIONS.FINANCIAL_MODEL_VIEW,
};

export function exportViewPermission(type: string | undefined): PermissionCode | null {
  return type && Object.hasOwn(VIEW_PERMISSION, type) ? VIEW_PERMISSION[type] : null;
}

/** Может ли пользователь с этими правами выгрузить отчёт этого вида. */
export function canExportReport(permissions: readonly string[], type: string | undefined): boolean {
  const view = exportViewPermission(type);
  if (!view) return false;
  if (permissions.includes(PERMISSIONS.ADMIN_FULL)) return true;
  return permissions.includes(PERMISSIONS.REPORTS_EXPORT) && permissions.includes(view);
}
