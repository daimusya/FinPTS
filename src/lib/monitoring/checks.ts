/**
 * Проверки мониторинга — чистые функции: на вход факты о системе, на выход
 * состояние (ok / warn / fail) и понятное сообщение. Факты собирает
 * load.ts, оповещения рассылает alerts.ts.
 */
export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  key: string;
  title: string;
  status: CheckStatus;
  message: string;
  /** Где разбираться: страница приложения. */
  link: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const hours = (ms: number) => Math.round(ms / HOUR);
const showDay = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "UTC" });

export function checkDatabase(latencyMs: number | null): CheckResult {
  const base = { key: "database", title: "База данных", link: null };
  if (latencyMs === null) return { ...base, status: "fail", message: "База данных недоступна" };
  if (latencyMs > 1000) return { ...base, status: "warn", message: `База отвечает медленно: ${latencyMs} мс на простой запрос` };
  return { ...base, status: "ok", message: `Отвечает за ${latencyMs} мс` };
}

export function checkBackup(input: { state: "ok" | "stale" | "never"; ageHours: number | null; mirror: "ok" | "failed" | "off" }): CheckResult {
  const base = { key: "backup", title: "Резервные копии", link: "/admin/backups" };
  if (input.state === "never") return { ...base, status: "fail", message: "Ни одной успешной резервной копии" };
  if (input.state === "stale") return { ...base, status: "fail", message: `Последняя успешная копия — ${Math.round(input.ageHours ?? 0)} ч назад` };
  if (input.mirror === "failed") return { ...base, status: "warn", message: "Копия сделана, но вторая копия в другом месте не записалась" };
  return { ...base, status: "ok", message: `Последняя копия ${Math.round(input.ageHours ?? 0)} ч назад${input.mirror === "ok" ? ", вторая копия на месте" : ""}` };
}

export interface ConnectionFact {
  label: string;
  lastStatus: string | null;
  lastSuccessAt: Date | null;
  lastMessage: string | null;
}

/** Выписки по API: ошибка последнего запуска — сбой; нет успешной загрузки 3 часа (запуск каждые 30 минут) — предупреждение. */
export function checkBankApi(connections: ConnectionFact[], now: Date): CheckResult {
  const base = { key: "bank_api", title: "Выписки по API банков", link: "/integrations/banks" };
  if (connections.length === 0) return { ...base, status: "ok", message: "Подключённых счетов нет" };
  const failed = connections.filter((c) => c.lastStatus === "error");
  if (failed.length > 0) {
    return { ...base, status: "fail", message: `Ошибка загрузки: ${failed.map((c) => `${c.label}${c.lastMessage ? ` — ${c.lastMessage}` : ""}`).join("; ")}` };
  }
  const stale = connections.filter((c) => !c.lastSuccessAt || now.getTime() - c.lastSuccessAt.getTime() > 3 * HOUR);
  if (stale.length > 0) {
    return {
      ...base,
      status: "warn",
      message: `Давно не загружалось: ${stale.map((c) => `${c.label} (${c.lastSuccessAt ? `${hours(now.getTime() - c.lastSuccessAt.getTime())} ч` : "ни разу"})`).join(", ")} — проверьте задачу Планировщика`,
    };
  }
  return { ...base, status: "ok", message: `${connections.length} ${plural(connections.length, "счёт", "счёта", "счетов")}, загружено по расписанию` };
}

/** Курсы валют для валютных счетов: нет курса или последний старше 4 дней (выходные плюс праздник). */
export function checkCurrencyRates(latest: Array<{ currency: string; date: Date | null }>, now: Date): CheckResult {
  const base = { key: "currency_rates", title: "Курсы валют", link: "/master-data/currency-rates#cbr" };
  if (latest.length === 0) return { ...base, status: "ok", message: "Валютных счетов нет" };
  const old = latest.filter((l) => !l.date || now.getTime() - l.date.getTime() > 4 * DAY);
  if (old.length > 0) {
    return { ...base, status: "warn", message: `Нет свежего курса: ${old.map((l) => `${l.currency} (${l.date ? `последний на ${showDay(l.date)}` : "ни одного"})`).join(", ")}` };
  }
  return { ...base, status: "ok", message: `Курсы ${latest.map((l) => l.currency).join(", ")} свежие` };
}

/** Свободное место на диске с резервными копиями. */
export function checkDisk(input: { freeBytes: number; totalBytes: number } | null): CheckResult {
  const base = { key: "disk", title: "Место на диске", link: null };
  if (!input || input.totalBytes <= 0) return { ...base, status: "ok", message: "Размер диска не определён" };
  const gb = (b: number) => (b / 1024 ** 3).toFixed(1).replace(".", ",");
  const share = input.freeBytes / input.totalBytes;
  const text = `Свободно ${gb(input.freeBytes)} ГБ из ${gb(input.totalBytes)} ГБ (${Math.round(share * 100)}%)`;
  if (input.freeBytes < 0.5 * 1024 ** 3 || share < 0.01) return { ...base, status: "fail", message: `${text} — резервные копии могут не записаться` };
  if (input.freeBytes < 2 * 1024 ** 3 || share < 0.05) return { ...base, status: "warn", message: `${text} — место заканчивается` };
  return { ...base, status: "ok", message: text };
}

/**
 * Закрытие месяца: с 15-го числа прошлый месяц должен быть закрыт — если
 * закрытием периодов вообще пользуются (хотя бы один период закрывали).
 */
export function checkPeriodClose(input: { usesClosing: boolean; previousClosed: boolean; previousLabel: string; dayOfMonth: number }): CheckResult {
  const base = { key: "period_close", title: "Закрытие периода", link: "/admin/periods" };
  if (!input.usesClosing) return { ...base, status: "ok", message: "Закрытие периодов пока не используется" };
  if (input.previousClosed) return { ...base, status: "ok", message: `${input.previousLabel} закрыт` };
  if (input.dayOfMonth >= 15) return { ...base, status: "warn", message: `${input.previousLabel} не закрыт, а уже ${input.dayOfMonth}-е число` };
  return { ...base, status: "ok", message: `${input.previousLabel} ещё открыт — закрыть до 15-го` };
}

/** Согласованные, но не оплаченные в срок заявки и заявки, которые больше 3 дней ждут решения. */
export function checkPayments(input: { overdue: number; overdueSum: string; stuck: number }): CheckResult {
  const base = { key: "payments", title: "Заявки на оплату", link: "/payment-calendar" };
  const parts: string[] = [];
  if (input.overdue > 0) parts.push(`просрочена оплата ${input.overdue} ${plural(input.overdue, "заявки", "заявок", "заявок")} на ${input.overdueSum}`);
  if (input.stuck > 0) parts.push(`${input.stuck} ${plural(input.stuck, "заявка", "заявки", "заявок")} больше 3 дней ждут решения`);
  return parts.length > 0 ? { ...base, status: "warn", message: parts.join("; ") } : { ...base, status: "ok", message: "Просроченных и зависших заявок нет" };
}

/** Операции банка, которые больше 14 дней не сопоставлены с документами. */
export function checkUnmatched(count: number): CheckResult {
  const base = { key: "unmatched", title: "Несопоставленные операции", link: "/cash/transactions?matchStatus=UNMATCHED" };
  return count > 0
    ? { ...base, status: "warn", message: `${count} ${plural(count, "операция", "операции", "операций")} больше 14 дней без сопоставления с документами` }
    : { ...base, status: "ok", message: "Старых несопоставленных операций нет" };
}

/** Доставка уведомлений на почту и в Telegram: не ушедшие после всех попыток за сутки и застрявшие в очереди. */
export function checkDelivery(input: { failedLastDay: number; stuck: number; lastError: string | null }): CheckResult {
  const base = { key: "delivery", title: "Доставка уведомлений", link: "/admin/notification-channels" };
  if (input.failedLastDay > 0) {
    return { ...base, status: "warn", message: `За сутки не доставлено ${input.failedLastDay}${input.lastError ? `: ${input.lastError}` : ""}` };
  }
  if (input.stuck > 0) return { ...base, status: "warn", message: `${input.stuck} ждут отправки дольше часа` };
  return { ...base, status: "ok", message: "Очередь пуста" };
}

/** Худшее состояние из проверок — общий итог. */
export function overallStatus(checks: CheckResult[]): CheckStatus {
  return checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
}
