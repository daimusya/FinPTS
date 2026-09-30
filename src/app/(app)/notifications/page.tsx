import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { markAllNotificationsReadAction, openNotificationAction } from "./actions";
import { MyNotificationChannels } from "@/components/my-notification-channels";

const dateTime = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ channelError?: string; channelNotice?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const sp = await searchParams;
  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Уведомления</h1>
          <p>
            Решения по вашим заявкам на оплату (согласована, отклонена, возвращена на доработку, оплачена, отменена) и
            заявки, которые ждут вашего решения. Последние 100.
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <button type="submit" className="btn btn-secondary">
              Отметить все прочитанными
            </button>
          </form>
        ) : null}
      </div>

      <div className="card">
        {notifications.length === 0 ? (
          <p className="empty-state">Уведомлений пока нет.</p>
        ) : (
          <ul className="notification-list">
            {notifications.map((n) => (
              <li key={n.id} className={n.readAt ? "notification notification--read" : "notification"}>
                <form action={openNotificationAction.bind(null, n.id)}>
                  <button type="submit" className="notification__open">
                    <span className="notification__title">
                      {n.readAt ? null : <span className="badge badge-warning" style={{ marginRight: 6 }}>новое</span>}
                      {n.title}
                    </span>
                    {n.body ? <span className="notification__body">{n.body}</span> : null}
                    <span className="notification__time">{dateTime(n.createdAt)}</span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MyNotificationChannels userId={session.userId} error={sp.channelError} notice={sp.channelNotice} />
    </div>
  );
}
