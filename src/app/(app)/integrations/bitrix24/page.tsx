import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { saveBitrix24ProfileAction, sendOutboxEventAction } from "./actions";

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

export default async function Bitrix24IntegrationPage() {
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

  const webhookUrl = (profile?.config as { webhookUrl?: string } | null)?.webhookUrl ?? "";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Битрикс24 — очередь событий</h1>
          <p>
            В очередь автоматически попадают только подтверждённые финансовые события: смена статуса оплаты
            проведённого документа начисления (поступление/частичная/полная оплата, сумма задолженности,
            просрочка). Отправка идемпотентна — повтор с тем же состоянием не создаёт дубль в очереди.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Настройка вебхука</h2>
        <form action={saveBitrix24ProfileAction}>
          <label className="field">
            <span>Адрес вебхука Битрикс24</span>
            <input type="text" name="webhookUrl" defaultValue={webhookUrl} placeholder="https://your-domain.bitrix24.ru/rest/1/xxxxxxx/" />
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

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Очередь</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Тип события</th>
                <th>Документ</th>
                <th>Статус</th>
                <th>Попыток</th>
                <th>Ошибка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const payload = event.payload as { documentNumber?: string; paymentStatus?: string };
                return (
                  <tr key={event.id}>
                    <td className="mono">{event.createdAt.toLocaleString("ru-RU")}</td>
                    <td>{event.eventType}</td>
                    <td>
                      {payload.documentNumber ?? "—"} {payload.paymentStatus ? `(${payload.paymentStatus})` : ""}
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
