export type DriverCode =
  | "avg_check"
  | "sales_count"
  | "seasonality_pct"
  | "new_service_activation_pct"
  | "intermediary_share_pct"
  | "intermediary_commission_pct"
  | "variable_cost_pct"
  | "fixed_costs"
  | "headcount"
  | "avg_employee_cost"
  | "productivity_per_employee"
  | "loan_payment"
  | "customer_payment_days"
  | "supplier_payment_days";

export interface DriverDef {
  code: DriverCode;
  label: string;
  unit: string;
  /** Если true — драйвер вводится не «в общем по сценарию», а отдельными
   * строками на подразделение (через dimension = departmentId), например
   * производительность на сотрудника отдела обучения / охраны труда. */
  perDepartment?: boolean;
  defaultValue?: number;
}

export const GENERAL_DRIVERS: DriverDef[] = [
  { code: "avg_check", label: "Средний чек", unit: "₽" },
  { code: "sales_count", label: "Количество продаж", unit: "шт/мес" },
  { code: "seasonality_pct", label: "Сезонность (доля от базы)", unit: "%", defaultValue: 100 },
  // Historically «Активация новых услуг»; new services now have their own list (FinancialScenarioNewService),
  // this stays as a plain multiplier on the base revenue so existing scenarios keep their numbers.
  { code: "new_service_activation_pct", label: "Корректировка базовой выручки (доля от базы)", unit: "%", defaultValue: 100 },
  { code: "intermediary_share_pct", label: "Доля продаж через посредников", unit: "%" },
  { code: "intermediary_commission_pct", label: "Комиссия посредника", unit: "%" },
  { code: "variable_cost_pct", label: "Переменные расходы (доля от выручки)", unit: "%" },
  { code: "fixed_costs", label: "Постоянные расходы", unit: "₽/мес" },
  { code: "headcount", label: "Численность (прочий персонал, вручную)", unit: "чел" },
  { code: "avg_employee_cost", label: "Средняя стоимость сотрудника в месяц (ФОТ+взносы)", unit: "₽/мес" },
  { code: "customer_payment_days", label: "Отсрочка оплаты клиентов", unit: "дней" },
  { code: "supplier_payment_days", label: "Отсрочка оплаты поставщикам (переменные расходы)", unit: "дней" },
  // Loans with a schedule and interest are listed separately (FinancialScenarioLoan); this stays for ad-hoc payments.
  { code: "loan_payment", label: "Прочие платежи по кредитам/лизингу (вручную, без графика)", unit: "₽/мес" },
];

export const DEPARTMENT_DRIVERS: DriverDef[] = [
  { code: "sales_count", label: "Продажи подразделения", unit: "шт/мес", perDepartment: true },
  { code: "productivity_per_employee", label: "Производительность на сотрудника", unit: "шт/мес/чел", perDepartment: true },
];

export const ALL_DRIVER_DEFS = [...GENERAL_DRIVERS, ...DEPARTMENT_DRIVERS];

export const MONTH_NAMES_SHORT = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

export const SCENARIO_TYPE_LABELS: Record<string, string> = {
  base: "Базовый",
  optimistic: "Оптимистичный",
  pessimistic: "Пессимистичный",
  custom: "Пользовательский",
};
