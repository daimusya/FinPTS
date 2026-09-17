export const PERMISSIONS = {
  ADMIN_FULL: "admin.full",
  MASTERDATA_VIEW: "masterdata.view",
  MASTERDATA_MANAGE: "masterdata.manage",
  ACCRUALS_VIEW: "accruals.view",
  ACCRUALS_MANAGE: "accruals.manage",
  CASH_VIEW: "cash.view",
  CASH_MANAGE: "cash.manage",
  PAYROLL_VIEW: "payroll.view",
  PAYROLL_MANAGE: "payroll.manage",
  REPORTS_VIEW: "reports.view",
  REPORTS_EXPORT: "reports.export",
  PERIODS_MANAGE: "periods.manage",
  PERIODS_REOPEN: "periods.reopen",
  INTEGRATIONS_MANAGE: "integrations.manage",
  AUDIT_VIEW: "audit.view",
  USERS_MANAGE: "users.manage",
  PAYMENT_REQUEST_CREATE: "payment_requests.create",
  PAYMENT_REQUEST_APPROVE: "payment_requests.approve",
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  [PERMISSIONS.ADMIN_FULL]: "Полный административный доступ",
  [PERMISSIONS.MASTERDATA_VIEW]: "Просмотр справочников",
  [PERMISSIONS.MASTERDATA_MANAGE]: "Управление справочниками",
  [PERMISSIONS.ACCRUALS_VIEW]: "Просмотр начислений",
  [PERMISSIONS.ACCRUALS_MANAGE]: "Управление начислениями",
  [PERMISSIONS.CASH_VIEW]: "Просмотр движения денег",
  [PERMISSIONS.CASH_MANAGE]: "Управление движением денег",
  [PERMISSIONS.PAYROLL_VIEW]: "Просмотр зарплаты",
  [PERMISSIONS.PAYROLL_MANAGE]: "Управление зарплатой",
  [PERMISSIONS.REPORTS_VIEW]: "Просмотр отчётов",
  [PERMISSIONS.REPORTS_EXPORT]: "Экспорт отчётов",
  [PERMISSIONS.PERIODS_MANAGE]: "Закрытие периодов",
  [PERMISSIONS.PERIODS_REOPEN]: "Повторное открытие периодов",
  [PERMISSIONS.INTEGRATIONS_MANAGE]: "Управление интеграциями",
  [PERMISSIONS.AUDIT_VIEW]: "Просмотр журнала аудита",
  [PERMISSIONS.USERS_MANAGE]: "Управление пользователями и ролями",
  [PERMISSIONS.PAYMENT_REQUEST_CREATE]: "Создание заявок на оплату",
  [PERMISSIONS.PAYMENT_REQUEST_APPROVE]: "Согласование заявок на оплату",
};

export const ROLE_DEFINITIONS: Array<{
  code: string;
  name: string;
  isSystem: boolean;
  permissions: PermissionCode[];
}> = [
  {
    code: "full_admin",
    name: "Полный администратор",
    isSystem: true,
    permissions: [PERMISSIONS.ADMIN_FULL],
  },
  {
    code: "operational_director",
    name: "Операционный директор",
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERDATA_VIEW,
      PERMISSIONS.MASTERDATA_MANAGE,
      PERMISSIONS.ACCRUALS_VIEW,
      PERMISSIONS.CASH_VIEW,
      PERMISSIONS.PAYROLL_VIEW,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.REPORTS_EXPORT,
      PERMISSIONS.PERIODS_MANAGE,
      PERMISSIONS.AUDIT_VIEW,
      PERMISSIONS.PAYMENT_REQUEST_APPROVE,
    ],
  },
  {
    code: "financial_director",
    name: "Финансовый директор",
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERDATA_VIEW,
      PERMISSIONS.ACCRUALS_VIEW,
      PERMISSIONS.ACCRUALS_MANAGE,
      PERMISSIONS.CASH_VIEW,
      PERMISSIONS.CASH_MANAGE,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.REPORTS_EXPORT,
      PERMISSIONS.PERIODS_MANAGE,
      PERMISSIONS.PAYMENT_REQUEST_APPROVE,
    ],
  },
  {
    code: "accountant",
    name: "Бухгалтер",
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERDATA_VIEW,
      PERMISSIONS.ACCRUALS_VIEW,
      PERMISSIONS.ACCRUALS_MANAGE,
      PERMISSIONS.CASH_VIEW,
      PERMISSIONS.CASH_MANAGE,
      PERMISSIONS.REPORTS_VIEW,
    ],
  },
  {
    code: "hr",
    name: "HR",
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERDATA_VIEW,
      PERMISSIONS.PAYROLL_VIEW,
      PERMISSIONS.PAYROLL_MANAGE,
    ],
  },
  {
    code: "department_head",
    name: "Руководитель подразделения",
    isSystem: true,
    permissions: [
      PERMISSIONS.MASTERDATA_VIEW,
      PERMISSIONS.REPORTS_VIEW,
      PERMISSIONS.PAYMENT_REQUEST_CREATE,
    ],
  },
  {
    code: "employee",
    name: "Сотрудник",
    isSystem: true,
    permissions: [PERMISSIONS.PAYMENT_REQUEST_CREATE],
  },
  {
    code: "viewer",
    name: "Просмотр отчётности",
    isSystem: true,
    permissions: [PERMISSIONS.REPORTS_VIEW],
  },
];
