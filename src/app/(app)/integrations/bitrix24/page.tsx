import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { decryptSecret, maskSecret } from "@/lib/crypto/secret-box";
import { enqueueAllProjectResultsAction, saveBitrix24ProfileAction, sendOutboxEventAction } from "./actions";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { loadProjectResult } from "@/lib/integrations/project-results";

const EVENT_LABELS: Record<string, string> = {
  payment_status_changed: "Статус оплаты документа",
  project_financial_result: "Финрезультат проекта",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Ожидает отправки",
  sent: "Отправлено",
  failed: "Ошибка",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "badge-warning",
  sent: "badge-active",
  failed: "badge-danger",
};

export default async function Bitrix24IntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ checked?: string; queued?: string }>;
}) {
  const sp = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.INTEGRATIONS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления интеграциями.</div>
      </div>
    );
  }

  const [profile, events] = await Promise.all([
    prisma.integrationProfile.findFirst({ where: { system: "BITRIX24" } }),
    prisma.integrationOutbox.findMany({
      where: { targetSystem: "BITRIX24" },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const linkedProjects = await prisma.project.findMany({
    where: { bitrixDealId: { not: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, bitrixDealId: true, isArchived: true },
  });
  const projectResults = await Promise.all(
    linkedProjects.map(async (project) => ({ project, result: await loadProjectResult(project.id) })),
  );
  const lastProjectEvent = new Map<string, { status: string; createdAt: Date }>();
  for (const event of events) {
    const projectId = (event.payload as { projectId?: string }).projectId;
    if (event.eventType === "project_financial_result" && projectId && !lastProjectEvent.has(projectId)) {
      lastProjectEvent.set(projectId, { status: event.status, createdAt: event.createdAt });
    }
  }

  const webhookUrlEnc = (profile?.config as { webhookUrlEnc?: string } | null)?.webhookUrlEnc;
  const webhookMasked = webhookUrlEnc ? maskSecret(decryptSecret(webhookUrlEnc)) : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Битрикс24 — очередь событий</h1>
          <p>
            В очередь автоматически попадают только подтверждённые финансовые события: смена статуса оплаты
            проведённого документа начисления (поступление/частичная/полная оплата, сумма задолженности,
            просрочка) и изменение финансового результата проекта, привязанного к сделке. Отправка
            идемпотентна — повтор с тем же состоянием не создаёт дубль в очереди.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Настройка вебхука</h2>
        <form action={saveBitrix24ProfileAction}>
          {webhookMasked ? (
            <p className="text-muted" style={{ marginBottom: 8 }}>
              Текущий вебхук: <span className="mono">{webhookMasked}</span> (хранится в зашифрованном виде)
            </p>
          ) : null}
          <label className="field">
            <span>{webhookMasked ? "Новый адрес вебхука (оставьте пустым, чтобы не менять)" : "Адрес вебхука Битрикс24"}</span>
            <input type="text" name="webhookUrl" placeholder="https://your-domain.bitrix24.ru/rest/1/xxxxxxx/" />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" name="isEnabled" defaultChecked={profile?.isEnabled ?? false} />
            Интеграция включена (без адреса вебхука включить нельзя)
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить
            </button>
          </div>
        </form>
        {!profile?.isEnabled ? (
          <p className="text-muted" style={{ marginTop: 10 }}>
            Пока интеграция выключена, события копятся в очереди со статусом «Ожидает отправки» и не
            отправляются.
          </p>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Финансовый результат проектов</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Для проектов с заполненным полем «ID сделки в Битрикс24» (справочник{" "}
          <Link href="/master-data/projects">«Проекты»</Link>) результат уходит в сделку: выручка и расходы,
          отнесённые на проект, за всё время по проведённым документам, результат и маржа, получено от клиентов и
          осталось получить, оплачено поставщикам и осталось оплатить. Общие косвенные расходы компании не
          распределяются. Новое событие ставится в очередь автоматически, когда меняются документы или оплаты
          проекта, — и только если цифры действительно изменились.
        </p>
        {sp.checked ? (
          <p className="form-success" style={{ marginBottom: 12 }}>
            Проверено проектов: {sp.checked}, поставлено в очередь новых результатов: {sp.queued} (у остальных цифры
            не изменились).
          </p>
        ) : null}
        <div className="table-wrap" style={{ marginBottom: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Проект</th>
                <th>Сделка</th>
                <th>Выручка</th>
                <th>Расходы</th>
                <th>Результат</th>
                <th>Маржа</th>
                <th>Получено</th>
                <th>Осталось получить</th>
                <th>Последнее событие</th>
              </tr>
            </thead>
            <tbody>
              {projectResults.map(({ project, result }) => {
                const last = lastProjectEvent.get(project.id);
                return (
                  <tr key={project.id}>
                    <td>
                      {project.name}
                      {project.isArchived ? <span className="text-muted"> (в архиве)</span> : null}
                    </td>
                    <td className="mono">{project.bitrixDealId}</td>
                    <td className="mono">{formatMoney(result.revenue.plus(result.otherIncome))}</td>
                    <td className="mono">{formatMoney(result.directCosts.plus(result.otherCosts))}</td>
                    <td className="mono">{formatMoney(result.financialResult)}</td>
                    <td>{result.marginPct ? `${result.marginPct.toFixed(1)}%` : "—"}</td>
                    <td className="mono">{formatMoney(result.receivedFromCustomers)}</td>
                    <td className="mono">{formatMoney(result.receivable)}</td>
                    <td>
                      {last ? (
                        <span className={`badge ${STATUS_BADGE[last.status] ?? "badge-archived"}`}>
                          {STATUS_LABELS[last.status] ?? last.status}
                        </span>
                      ) : (
                        <span className="text-muted">ещё не было</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {projectResults.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Ни один проект не привязан к сделке Битрикс24.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <form action={enqueueAllProjectResultsAction}>
          <button type="submit" className="btn btn-secondary" disabled={projectResults.length === 0}>
            Пересчитать и поставить в очередь изменившиеся результаты
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Очередь</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип события</th>
                <th>Объект</th>
                <th>Статус</th>
                <th>Попыток</th>
                <th>Ошибка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const payload = event.payload as {
                  documentNumber?: string;
                  paymentStatus?: string;
                  projectName?: string;
                  bitrixDealId?: string;
                  financialResult?: string;
                };
                return (
                  <tr key={event.id}>
                    <td className="mono">{event.createdAt.toLocaleString("ru-RU")}</td>
                    <td>{EVENT_LABELS[event.eventType] ?? event.eventType}</td>
                    <td>
                      {payload.projectName
                        ? `${payload.projectName} → сделка ${payload.bitrixDealId}, результат ${formatMoney(payload.financialResult ?? 0)}`
                        : `${payload.documentNumber ?? "—"} ${payload.paymentStatus ? `(${payload.paymentStatus})` : ""}`}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[event.status] ?? "badge-archived"}`}>
                        {STATUS_LABELS[event.status] ?? event.status}
                      </span>
                    </td>
                    <td>{event.attempts}</td>
                    <td className="text-muted">{event.lastError ?? "—"}</td>
                    <td>
                      {event.status !== "sent" ? (
                        <form action={sendOutboxEventAction.bind(null, event.id)}>
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Отправить
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Событий пока нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
