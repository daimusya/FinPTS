import { PERMISSIONS, type PermissionCode } from "@/lib/permissions";

export interface DashboardBlocks {
  cash: boolean;
  debts: boolean;
  requests: boolean;
  masterData: boolean;
  employees: boolean;
  periods: boolean;
  pnl: boolean;
}

/**
 * Какие блоки дашборда показывать по правам: деньги — банк и касса, долги —
 * начисления или отчёты, заявки — деньги или заявки, справочные количества —
 * справочники, сотрудники — зарплата, периоды — закрытие или отчёты, прибыль
 * — отчёты. Полный администратор видит всё.
 */
export function dashboardBlocks(permissions: string[]): DashboardBlocks {
  const can = (code: PermissionCode) => permissions.includes(PERMISSIONS.ADMIN_FULL) || permissions.includes(code);
  return {
    cash: can(PERMISSIONS.CASH_VIEW),
    debts: can(PERMISSIONS.ACCRUALS_VIEW) || can(PERMISSIONS.REPORTS_VIEW),
    requests: can(PERMISSIONS.CASH_VIEW) || can(PERMISSIONS.PAYMENT_REQUEST_APPROVE) || can(PERMISSIONS.PAYMENT_REQUEST_CREATE),
    masterData: can(PERMISSIONS.MASTERDATA_VIEW),
    employees: can(PERMISSIONS.PAYROLL_VIEW),
    periods: can(PERMISSIONS.PERIODS_MANAGE) || can(PERMISSIONS.REPORTS_VIEW),
    pnl: can(PERMISSIONS.REPORTS_VIEW),
  };
}
