export const EMPLOYEE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Работает",
  ON_LEAVE: "В отпуске/на больничном",
  TERMINATED: "Уволен",
};

export const EMPLOYEE_STATUS_BADGE: Record<string, string> = {
  ACTIVE: "badge-active",
  ON_LEAVE: "badge-warning",
  TERMINATED: "badge-archived",
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Наличный",
  BANK: "Безналичный",
  MIXED: "Смешанный",
};

export const PAYROLL_RUN_KIND_LABELS: Record<string, string> = {
  ADVANCE: "Аванс (25 число)",
  FINAL: "Окончательный расчёт (10 число)",
  ADHOC: "Разовый расчёт",
};

export const PAYROLL_RUN_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  CALCULATED: "Рассчитан",
  APPROVED: "Утверждён",
  PAID: "Выплачен",
};

export const PAYROLL_RUN_STATUS_BADGE: Record<string, string> = {
  DRAFT: "badge-archived",
  CALCULATED: "badge-warning",
  APPROVED: "badge-orange",
  PAID: "badge-active",
};

export const TIME_SHEET_DAY_TYPE_LABELS: Record<string, string> = {
  work: "Рабочий день",
  weekend: "Выходной",
  vacation: "Отпуск",
  sick_leave: "Больничный",
  business_trip: "Командировка",
  absence: "Отсутствие",
  overtime: "Сверхурочные",
  project: "Проектные часы",
};
