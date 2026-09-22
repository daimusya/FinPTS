import { prisma } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import type { DictionaryConfig, DictionaryDelegate, FieldOption } from "./types";

function delegate(d: unknown): DictionaryDelegate {
  return d as DictionaryDelegate;
}

async function organizationOptions(): Promise<FieldOption[]> {
  const rows = await prisma.organization.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

async function directionOptions(): Promise<FieldOption[]> {
  const rows = await prisma.direction.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

async function counterpartyOptions(): Promise<FieldOption[]> {
  const rows = await prisma.counterparty.findMany({
    where: { isArchived: false },
    orderBy: { fullName: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: r.fullName }));
}

async function pnlArticleOptions(): Promise<FieldOption[]> {
  const rows = await prisma.pnlArticle.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

async function departmentOptions(excludeId?: string): Promise<FieldOption[]> {
  const rows = await prisma.department.findMany({
    where: { isArchived: false, NOT: excludeId ? { id: excludeId } : undefined },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

export async function bankAccountOptions(): Promise<FieldOption[]> {
  const rows = await prisma.bankAccount.findMany({
    where: { isArchived: false },
    orderBy: { bankName: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: `${r.bankName} · ${r.accountNumber}` }));
}

export async function cashAccountOptions(): Promise<FieldOption[]> {
  const rows = await prisma.cashAccount.findMany({
    where: { isArchived: false },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}

const ORGANIZATION_TYPE_OPTIONS: FieldOption[] = [
  { value: "LEGAL_ENTITY", label: "Юридическое лицо" },
  { value: "SOLE_PROPRIETOR", label: "ИП" },
];

const PROJECT_STATUS_OPTIONS: FieldOption[] = [
  { value: "active", label: "Активный" },
  { value: "paused", label: "Приостановлен" },
  { value: "closed", label: "Закрыт" },
];

const CONTRACT_STATUS_OPTIONS: FieldOption[] = [
  { value: "active", label: "Действует" },
  { value: "completed", label: "Исполнен" },
  { value: "terminated", label: "Расторгнут" },
];

const CASH_FLOW_DIRECTION_OPTIONS: FieldOption[] = [
  { value: "INFLOW", label: "Поступление" },
  { value: "OUTFLOW", label: "Выплата" },
  { value: "TRANSFER", label: "Перевод между счетами" },
];

const PNL_ARTICLE_TYPE_OPTIONS: FieldOption[] = [
  { value: "REVENUE", label: "Выручка" },
  { value: "DIRECT_VARIABLE", label: "Прямые переменные расходы" },
  { value: "DIRECT_FIXED", label: "Прямые постоянные расходы" },
  { value: "INDIRECT", label: "Косвенные расходы" },
  { value: "OTHER_INCOME", label: "Прочие доходы" },
  { value: "OTHER_EXPENSE", label: "Прочие расходы" },
  { value: "TAX", label: "Налоги" },
];

const PAYMENT_METHOD_OPTIONS: FieldOption[] = [
  { value: "CASH", label: "Наличный" },
  { value: "BANK", label: "Безналичный" },
  { value: "MIXED", label: "Смешанный" },
];

const TAX_BASE_OPTIONS: FieldOption[] = [
  { value: "ndfl", label: "НДФЛ" },
  { value: "pension", label: "Пенсионное страхование" },
  { value: "medical", label: "Медицинское страхование" },
  { value: "social", label: "Социальное страхование" },
  { value: "injury", label: "Травматизм" },
];

const BALANCE_ARTICLE_CATEGORY_OPTIONS: FieldOption[] = [
  { value: "ASSET", label: "Актив" },
  { value: "LIABILITY", label: "Обязательство" },
  { value: "EQUITY", label: "Капитал" },
];

export const DICTIONARY_REGISTRY: Record<string, DictionaryConfig> = {
  organizations: {
    slug: "organizations",
    title: "Организации и ИП",
    singularTitle: "Организация",
    entityAuditType: "organization",
    delegate: delegate(prisma.organization),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "type", "inn"],
    fields: [
      { name: "name", label: "Полное наименование", type: "text", required: true },
      { name: "shortName", label: "Краткое наименование", type: "text" },
      { name: "type", label: "Тип", type: "select", required: true, options: ORGANIZATION_TYPE_OPTIONS },
      { name: "inn", label: "ИНН", type: "text" },
      { name: "kpp", label: "КПП", type: "text" },
      { name: "ogrn", label: "ОГРН / ОГРНИП", type: "text" },
      { name: "legalAddress", label: "Юридический адрес", type: "text" },
    ],
  },
  "bank-accounts": {
    slug: "bank-accounts",
    title: "Банковские счета",
    singularTitle: "Банковский счёт",
    entityAuditType: "bank_account",
    delegate: delegate(prisma.bankAccount),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { bankName: "asc" },
    listColumns: ["bankName", "accountNumber", "currency"],
    fields: [
      { name: "organizationId", label: "Организация", type: "select", required: true, loadOptions: organizationOptions },
      { name: "bankName", label: "Банк", type: "text", required: true },
      { name: "accountNumber", label: "Номер счёта", type: "text", required: true },
      { name: "bik", label: "БИК", type: "text" },
      { name: "currency", label: "Валюта", type: "text", defaultValue: "RUB" },
    ],
  },
  "cash-accounts": {
    slug: "cash-accounts",
    title: "Кассы",
    singularTitle: "Касса",
    entityAuditType: "cash_account",
    delegate: delegate(prisma.cashAccount),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "currency"],
    fields: [
      { name: "organizationId", label: "Организация", type: "select", required: true, loadOptions: organizationOptions },
      { name: "name", label: "Название кассы", type: "text", required: true },
      { name: "currency", label: "Валюта", type: "text", defaultValue: "RUB" },
    ],
  },
  departments: {
    slug: "departments",
    title: "Подразделения",
    singularTitle: "Подразделение",
    entityAuditType: "department",
    delegate: delegate(prisma.department),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "organizationId", label: "Организация", type: "select", loadOptions: organizationOptions },
      { name: "parentId", label: "Родительское подразделение", type: "select", loadOptions: departmentOptions },
    ],
  },
  "cost-centers": {
    slug: "cost-centers",
    title: "ЦФО",
    singularTitle: "ЦФО",
    entityAuditType: "cost_center",
    delegate: delegate(prisma.costCenter),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "code"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "code", label: "Код", type: "text" },
    ],
  },
  projects: {
    slug: "projects",
    title: "Проекты",
    singularTitle: "Проект",
    entityAuditType: "project",
    delegate: delegate(prisma.project),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "code", "status"],
    fields: [
      { name: "organizationId", label: "Организация", type: "select", required: true, loadOptions: organizationOptions },
      { name: "name", label: "Название", type: "text", required: true },
      { name: "code", label: "Код", type: "text" },
      { name: "status", label: "Статус", type: "select", options: PROJECT_STATUS_OPTIONS },
      { name: "startDate", label: "Дата начала", type: "date" },
      { name: "endDate", label: "Дата окончания", type: "date" },
    ],
  },
  directions: {
    slug: "directions",
    title: "Направления",
    singularTitle: "Направление",
    entityAuditType: "direction",
    delegate: delegate(prisma.direction),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name"],
    fields: [{ name: "name", label: "Название", type: "text", required: true }],
  },
  "products-services": {
    slug: "products-services",
    title: "Продукты и услуги",
    singularTitle: "Продукт / услуга",
    entityAuditType: "product_service",
    delegate: delegate(prisma.productService),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "unit"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "directionId", label: "Направление", type: "select", loadOptions: directionOptions },
      { name: "code", label: "Код", type: "text" },
      { name: "unit", label: "Единица измерения", type: "text" },
    ],
  },
  counterparties: {
    slug: "counterparties",
    title: "Контрагенты",
    singularTitle: "Контрагент",
    entityAuditType: "counterparty",
    delegate: delegate(prisma.counterparty),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { fullName: "asc" },
    listColumns: ["fullName", "inn", "isIntermediary"],
    fields: [
      { name: "fullName", label: "Полное наименование", type: "text", required: true },
      { name: "shortName", label: "Краткое наименование", type: "text" },
      { name: "inn", label: "ИНН", type: "text" },
      { name: "kpp", label: "КПП", type: "text" },
      { name: "ogrn", label: "ОГРН / ОГРНИП", type: "text" },
      { name: "legalAddress", label: "Юридический адрес", type: "text" },
      { name: "actualAddress", label: "Фактический адрес", type: "text" },
      { name: "director", label: "Руководитель", type: "text" },
      { name: "status", label: "Статус организации", type: "text" },
      { name: "isIntermediary", label: "Посредник", type: "checkbox" },
    ],
  },
  contracts: {
    slug: "contracts",
    title: "Договоры",
    singularTitle: "Договор",
    entityAuditType: "contract",
    delegate: delegate(prisma.contract),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { date: "desc" },
    listColumns: ["number", "date", "status", "amount"],
    fields: [
      { name: "organizationId", label: "Организация", type: "select", required: true, loadOptions: organizationOptions },
      { name: "counterpartyId", label: "Контрагент", type: "select", required: true, loadOptions: counterpartyOptions },
      { name: "number", label: "Номер", type: "text", required: true },
      { name: "date", label: "Дата", type: "date", required: true },
      { name: "subject", label: "Предмет договора", type: "text" },
      { name: "amount", label: "Сумма", type: "number" },
      { name: "status", label: "Статус", type: "select", options: CONTRACT_STATUS_OPTIONS },
    ],
  },
  "cash-flow-articles": {
    slug: "cash-flow-articles",
    title: "Статьи ДДС",
    singularTitle: "Статья ДДС",
    entityAuditType: "cash_flow_article",
    delegate: delegate(prisma.cashFlowArticle),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "direction"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "code", label: "Код", type: "text" },
      { name: "direction", label: "Направление", type: "select", required: true, options: CASH_FLOW_DIRECTION_OPTIONS },
    ],
  },
  "pnl-articles": {
    slug: "pnl-articles",
    title: "Статьи ОПиУ",
    singularTitle: "Статья ОПиУ",
    entityAuditType: "pnl_article",
    delegate: delegate(prisma.pnlArticle),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "type"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "code", label: "Код", type: "text" },
      { name: "type", label: "Тип", type: "select", required: true, options: PNL_ARTICLE_TYPE_OPTIONS },
    ],
  },
  "balance-articles": {
    slug: "balance-articles",
    title: "Статьи баланса",
    singularTitle: "Статья баланса",
    entityAuditType: "balance_article",
    delegate: delegate(prisma.balanceArticle),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "category"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "code", label: "Код", type: "text" },
      { name: "category", label: "Категория", type: "select", required: true, options: BALANCE_ARTICLE_CATEGORY_OPTIONS },
    ],
  },
  positions: {
    slug: "positions",
    title: "Должности",
    singularTitle: "Должность",
    entityAuditType: "position",
    delegate: delegate(prisma.position),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name"],
    fields: [{ name: "name", label: "Название", type: "text", required: true }],
  },
  "work-schedules": {
    slug: "work-schedules",
    title: "Графики работы",
    singularTitle: "График работы",
    entityAuditType: "work_schedule",
    delegate: delegate(prisma.workSchedule),
    permissionView: PERMISSIONS.MASTERDATA_VIEW,
    permissionManage: PERMISSIONS.MASTERDATA_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name"],
    fields: [{ name: "name", label: "Название", type: "text", required: true }],
  },
  "payroll-accrual-types": {
    slug: "payroll-accrual-types",
    title: "Виды начислений зарплаты",
    singularTitle: "Вид начисления",
    entityAuditType: "payroll_accrual_type",
    delegate: delegate(prisma.payrollAccrualType),
    permissionView: PERMISSIONS.PAYROLL_VIEW,
    permissionManage: PERMISSIONS.PAYROLL_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "code", "paymentMethod"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "code", label: "Код", type: "text", required: true },
      { name: "subjectToNdfl", label: "Облагается НДФЛ", type: "checkbox" },
      { name: "subjectToInsurance", label: "Облагается страховыми взносами", type: "checkbox" },
      { name: "affectsAvgEarnings", label: "Влияет на средний заработок", type: "checkbox" },
      { name: "paymentMethod", label: "Способ выплаты", type: "select", required: true, options: PAYMENT_METHOD_OPTIONS },
      { name: "pnlArticleId", label: "Статья расходов (ОПиУ)", type: "select", loadOptions: pnlArticleOptions },
    ],
  },
  "tax-rules": {
    slug: "tax-rules",
    title: "Налоговые и страховые правила",
    singularTitle: "Правило",
    entityAuditType: "tax_rule",
    delegate: delegate(prisma.taxRule),
    permissionView: PERMISSIONS.PAYROLL_VIEW,
    permissionManage: PERMISSIONS.PAYROLL_MANAGE,
    orderBy: { name: "asc" },
    listColumns: ["name", "base", "ratePct"],
    fields: [
      { name: "name", label: "Название", type: "text", required: true },
      { name: "code", label: "Код", type: "text", required: true },
      { name: "base", label: "Вид", type: "select", required: true, options: TAX_BASE_OPTIONS },
      { name: "ratePct", label: "Ставка, %", type: "number", required: true },
    ],
  },
};

export function getDictionaryConfig(slug: string): DictionaryConfig {
  const config = DICTIONARY_REGISTRY[slug];
  if (!config) {
    throw new Error(`Справочник "${slug}" не найден`);
  }
  return config;
}
