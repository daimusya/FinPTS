import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { markAllNotificationsReadAction, openNotificationAction } from "./actions";
import { MyNotificationChannels } from "@/components/my-notification-channels";
import { singleParams } from "@/lib/query-params";

const PAGE_SIZE = 50;
const dateTime = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ channelError?: string; channelNotice?: string; page?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const sp = singleParams(await searchParams);
  // The unread count covers all notifications, not only this page — the same number as in the header.
  const [total, unread] = await Promise.all([
    prisma.notification.count({ where: { userId: session.userId } }),
    prisma.notification.count({ where: { userId: session.userId, readAt: null } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  const pageHref = (n: number) => (n > 1 ? `/notifications?page=${n}` : "/notifications");

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Уведомления</h1>
          <p>
            Решения по вашим заявкам на оплату (согласована, отклонена, возвращена на доработку, оплачена, отменена) и
            заявки, которые ждут вашего решения.
          </p>
        </div>
        {unread > 0 ? (
          <form action={markAllNotificationsReadAction}>
            <button type="submit" className="btn btn-secondary">
              Отметить все прочитанными ({unread})
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
        {pages > 1 ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="btn btn-secondary btn-sm">
                ← Новее
              </Link>
            ) : null}
            <span className="text-muted" style={{ fontSize: 12 }}>
              Страница {page} из {pages} · всего {total}
            </span>
            {page < pages ? (
              <Link href={pageHref(page + 1)} className="btn btn-secondary btn-sm">
                Старее →
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>

      <MyNotificationChannels userId={session.userId} error={sp.channelError} notice={sp.channelNotice} />
    </div>
  );
}
