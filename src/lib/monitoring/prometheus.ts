import type { CheckResult } from "./checks";
import type { SystemMetrics } from "./load";

const STATUS_VALUE = { ok: 0, warn: 1, fail: 2 } as const;
const PREFIX = "promtehnosfera";

/** Текстовый формат Prometheus: состояние проверок (0 — в порядке, 1 — внимание, 2 — сбой) и счётчики. */
export function formatPrometheus(checks: CheckResult[], metrics: SystemMetrics): string {
  const lines: string[] = [
    `# HELP ${PREFIX}_check_status Monitoring check: 0 ok, 1 warn, 2 fail`,
    `# TYPE ${PREFIX}_check_status gauge`,
    ...checks.map((c) => `${PREFIX}_check_status{check="${c.key}"} ${STATUS_VALUE[c.status]}`),
  ];
  const gauges: Array<[string, string, number | null]> = [
    ["database_bytes", "Database size in bytes", metrics.databaseBytes],
    ["active_users", "Active users", metrics.activeUsers],
    ["organizations", "Active organizations", metrics.organizations],
    ["bank_transactions", "Bank and cash operations", metrics.bankTransactions],
    ["bank_transactions_last_7_days", "Operations loaded in the last 7 days", metrics.bankTransactionsLast7Days],
    ["accrual_documents", "Accrual documents", metrics.accrualDocuments],
    ["payment_requests_pending", "Payment requests awaiting a decision", metrics.paymentRequestsPending],
    ["unread_notifications", "Unread in-app notifications", metrics.unreadNotifications],
    ["process_uptime_seconds", "Server process uptime", metrics.processUptimeSeconds],
  ];
  for (const [name, help, value] of gauges) {
    if (value === null) continue;
    lines.push(`# HELP ${PREFIX}_${name} ${help}`, `# TYPE ${PREFIX}_${name} gauge`, `${PREFIX}_${name} ${value}`);
  }
  return `${lines.join("\n")}\n`;
}
