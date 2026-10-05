/**
 * Журнал аудита для человека: русские названия записей и действий, ссылка на
 * запись, что именно изменилось, — и скрытие секретов (хеш пароля, коды,
 * токены), чтобы они не попадали ни в журнал, ни на экран. Чистые функции —
 * проверяются тестами.
 */

export const ENTITY_LABELS: Record<string, string> = {
  accounting_period: "Учётный период",
  accrual_document: "Документ начисления",
  balance_entry: "Остаток баланса",
  bank_classification_rule: "Правило разнесения",
  bank_connection: "Подключение банка",
  bank_import_batch: "Загрузка выписки",
  bank_transaction: "Операция банка/кассы",
  budget: "Бюджет",
  counterparty_bank_detail: "Реквизиты контрагента",
  counterparty_contact: "Контакт контрагента",
  employee: "Сотрудник",
  employee_project_allocation: "Распределение по проектам",
  financial_scenario: "Сценарий финмодели",
  integration_batch: "Загрузка из 1С",
  integration_outbox: "Отправка в Битрикс24",
  integration_profile: "Настройки интеграции",
  organization_tax_rate: "Налоговая ставка организации",
  payment_allocation: "Сопоставление оплаты",
  payment_approval_route: "Маршрут согласования",
  payment_request: "Заявка на оплату",
  payroll_line: "Строка расчёта зарплаты",
  payroll_run: "Расчёт зарплаты",
  role: "Роль",
  session: "Вход в систему",
  time_sheet: "Табель",
  user: "Пользователь",
  user_access_scope: "Доступ пользователя",
};

export const ACTION_LABELS: Record<string, string> = {
  add_department: "добавлено подразделение",
  add_loan: "добавлен кредит",
  add_new_service: "добавлена новая услуга",
  approve: "утверждено",
  approve_step: "согласовано",
  archive: "в архив",
  assign_part_payment_account: "счёт оплаты части",
  assign_payment_account: "счёт оплаты",
  auto_classify_bulk: "авторазнесение",
  bulk_fill: "массовое заполнение",
  calculate: "расчёт",
  cancel: "отмена",
  change_own_password: "смена своего пароля",
  classify: "разнесение",
  classify_transfer_pair: "разнесение второй части перевода",
  close_period: "закрытие периода",
  copy_previous_year: "копия прошлого года",
  create: "создание",
  create_by_average_earnings: "создание по среднему заработку",
  create_by_inn: "создание по ИНН",
  create_by_inn_from_operations: "создание по ИНН из операций",
  create_manual: "создание вручную",
  create_manual_transfer: "перевод вручную",
  delete: "удаление",
  delete_transfer: "удаление перевода",
  disable: "отключение",
  edit: "исправление",
  edit_transfer: "исправление перевода",
  enable: "включение",
  end: "окончание",
  enqueue_project_results: "результаты проектов в очередь",
  fill_standard_tax_rates: "стандартные ставки налогов",
  hire: "приём",
  import: "загрузка",
  import_1c: "загрузка из 1С",
  import_api: "загрузка по API",
  link_counterparty_by_inn: "привязка контрагента по ИНН",
  load_cbr: "курсы ЦБ",
  login: "вход",
  logout: "выход",
  mark_paid: "оплачено",
  mark_part_paid: "оплачена часть",
  mark_part_paid_final: "оплачена последняя часть",
  notification_channels: "каналы уведомлений",
  post: "проведение",
  post_to_accrual: "проведение в начисления",
  refresh_by_inn: "обновление по ИНН",
  reject_step: "отклонено",
  remove_department: "удалено подразделение",
  remove_loan: "удалён кредит",
  remove_new_service: "удалена новая услуга",
  remove_schedule: "удалён график",
  reopen_period: "открытие периода",
  replace_credentials: "замена ключей доступа",
  reschedule: "перенос срока",
  reschedule_due_date: "перенос срока",
  reschedule_part: "перенос срока части",
  reset_password: "сброс пароля",
  restore: "из архива",
  resubmit: "повторная отправка",
  return_for_rework: "возврат на доработку",
  set_primary: "основной",
  telegram_link: "привязка Telegram",
  telegram_unlink: "отвязка Telegram",
  terminate: "увольнение",
  transfer: "перевод",
  update: "изменение",
  update_new_service: "изменена новая услуга",
  update_permissions: "изменение прав",
  update_tax: "изменение налогов",
  update_values: "изменение значений",
};

const OWN_PAGES: Record<string, (id: string) => string> = {
  accrual_document: (id) => `/accruals/${id}`,
  bank_transaction: (id) => `/cash/transactions/${id}`,
  employee: (id) => `/employees/${id}`,
  financial_scenario: (id) => `/financial-model/${id}`,
  payment_approval_route: (id) => `/admin/payment-approval-routes/${id}/edit`,
  payment_request: (id) => `/payment-requests/${id}`,
  payroll_run: (id) => `/payroll/${id}`,
  role: (id) => `/admin/roles/${id}/edit`,
  user: (id) => `/admin/users/${id}/edit`,
  user_access_scope: (id) => `/admin/users/${id}/edit`,
};

/** Ссылка на запись или null (сводные записи вроде «import», «bulk» и записи без своей страницы). */
export function entityLink(entityType: string, entityId: string, dictionarySlugs: Record<string, string>): string | null {
  if (!/^c[a-z0-9]{20,}$/.test(entityId)) return null;
  const own = OWN_PAGES[entityType];
  if (own) return own(entityId);
  const slug = dictionarySlugs[entityType];
  return slug ? `/master-data/${slug}/${entityId}/edit` : null;
}

const SECRET_KEY = /^(passwordHash|telegramLinkCode|.*(token|secret|apiKey|password|credentials|webhookUrl).*)$/i;
const SECRET_SAFE = /^(has|.*Changed$)/;
export const HIDDEN = "[скрыто]";

/** Копия значения, в которой секретные строки заменены на «[скрыто]» (флаги вроде hasWebhook, passwordChanged остаются). */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v)) as T;
  // Only plain objects: Decimal, Date and other class instances keep their own JSON form.
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SECRET_KEY.test(k) && !SECRET_SAFE.test(k) && (typeof v === "string" || typeof v === "number") ? HIDDEN : redactSecrets(v),
      ]),
    ) as T;
  }
  return value;
}

const NOISE = new Set(["id", "updatedAt", "createdAt"]);
const MAX_SHOWN = 120;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const dateOnly = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });

/** Даты из JSON — по-русски: полночь UTC (дата без времени) — только дата, иначе дата и время по Москве. */
function showDate(iso: string): string {
  const date = new Date(iso);
  return iso.slice(11, 23) === "00:00:00.000" ? dateOnly.format(date) : dateTime.format(date);
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "да" : "нет";
  const text = typeof value === "string" ? (ISO_DATE_TIME.test(value) ? showDate(value) : value) : JSON.stringify(value);
  return text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}…` : text;
}

export interface AuditChange {
  field: string;
  before: string;
  after: string;
}

/**
 * Что изменилось: поля «после», отличающиеся от «до» (при создании — все поля
 * «после», при удалении — все «до»). Служебные поля (id, даты записи) не показываются.
 */
export function auditChanges(before: unknown, after: unknown): AuditChange[] {
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  const b = obj(redactSecrets(before));
  const a = obj(redactSecrets(after));
  if (!a && !b) return [];
  const fields = a ? Object.keys(a) : Object.keys(b!);
  return fields
    .filter((f) => !NOISE.has(f))
    .filter((f) => !a || !b || JSON.stringify(a[f]) !== JSON.stringify(b[f]))
    .map((f) => ({ field: f, before: b ? show(b[f]) : "—", after: a ? show(a[f]) : "—" }));
}
