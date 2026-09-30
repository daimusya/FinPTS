import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { overallStatus, type CheckStatus } from "@/lib/monitoring/checks";
import { loadMetrics, runChecks } from "@/lib/monitoring/load";

const STATUS: Record<CheckStatus, { label: string; badge: string }> = {
  ok: { label: "В порядке", badge: "badge-active" },
  warn: { label: "Внимание", badge: "badge-warning" },
  fail: { label: "Сбой", badge: "badge-danger" },
};

const dateTime = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });
const number = (n: number) => new Intl.NumberFormat("ru-RU").format(n);

function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d} д ${h} ч` : h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

export default async function MonitoringPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.ADMIN_FULL)) {
    return (
      <div className="page">
        <div className="card">Раздел доступен только полному администратору.</div>
      </div>
    );
  }

  const now = new Date();
  const [checks, metrics, alerts] = await Promise.all([
    runChecks(now),
    loadMetrics(now),
    prisma.monitorAlert.findMany({ orderBy: { lastNotifiedAt: "desc" }, take: 30 }),
  ]);
  const overall = overallStatus(checks);
  const titleOf = new Map(checks.map((c) => [c.key, c.title]));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Мониторинг</h1>
          <p>
            Проверки состояния системы на {dateTime(now)}. Каждые 30 минут их запускает задача Планировщика вместе с загрузкой
            выписок: если проверка не в порядке, администраторам приходит уведомление (колокольчик), при затянувшейся проблеме —
            напоминание раз в сутки, когда проблема уходит — «снова в порядке». Вручную: <code>npm run monitor</code>.
          </p>
        </div>
        <span className={`badge ${STATUS[overall].badge}`} style={{ alignSelf: "flex-start", fontSize: 13 }}>
          {overall === "ok" ? "Всё в порядке" : STATUS[overall].label}
        </span>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Проверка</th>
                <th>Состояние</th>
                <th>Подробности</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c) => (
                <tr key={c.key}>
                  <td>{c.link ? <Link href={c.link}>{c.title}</Link> : c.title}</td>
                  <td>
                    <span className={`badge ${STATUS[c.status].badge}`}>{STATUS[c.status].label}</span>
                  </td>
                  <td>{c.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Размер базы данных</div>
          <div className="stat-value">{metrics.databaseBytes === null ? "—" : `${(metrics.databaseBytes / 1024 / 1024).toFixed(1)} МБ`}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Операций банка и кассы</div>
          <div className="stat-value">{number(metrics.bankTransactions)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            за 7 дней загружено {number(metrics.bankTransactionsLast7Days)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Документов начисления</div>
          <div className="stat-value">{number(metrics.accrualDocuments)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Заявок ждут решения</div>
          <div className="stat-value">{number(metrics.paymentRequestsPending)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Пользователей</div>
          <div className="stat-value">{number(metrics.activeUsers)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            организаций {number(metrics.organizations)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Сервер работает</div>
          <div className="stat-value">{duration(metrics.processUptimeSeconds)}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            без перезапуска
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Оповещения</h2>
        {alerts.length === 0 ? (
          <p className="text-muted">Оповещений ещё не было.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Проверка</th>
                  <th>Последнее состояние</th>
                  <th>Проблема с</th>
                  <th>Оповещали</th>
                  <th>Решена</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.key}>
                    <td>{titleOf.get(a.key) ?? a.key}</td>
                    <td>
                      <span className={`badge ${a.resolvedAt ? "badge-active" : (STATUS[a.status as CheckStatus]?.badge ?? "badge-warning")}`}>
                        {a.resolvedAt ? "В порядке" : (STATUS[a.status as CheckStatus]?.label ?? a.status)}
                      </span>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {a.message}
                      </div>
                    </td>
                    <td>{dateTime(a.firstSeenAt)}</td>
                    <td>{dateTime(a.lastNotifiedAt)}</td>
                    <td>{a.resolvedAt ? dateTime(a.resolvedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Для внешних систем</h2>
        <ul style={{ paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
          <li>
            <code>GET /api/health</code> — доступность базы и свежесть резервной копии, без авторизации (для аптайм-чекера).
          </li>
          <li>
            <code>GET /api/metrics</code> — эти проверки и показатели в формате Prometheus. Включается переменной{" "}
            <code>METRICS_TOKEN</code> в <code>.env</code>; запрос с заголовком <code>Authorization: Bearer …</code>. Без переменной
            адрес отвечает 404.
          </li>
        </ul>
      </div>
    </div>
  );
}
