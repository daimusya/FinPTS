import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import Link from "next/link";
import { Sidebar } from "@/components/sidebar";
import { unreadNotificationCount } from "@/lib/notifications";
import { logoutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const unread = await unreadNotificationCount(session.userId);

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <div />
          <div className="topbar-user">
            <Link href="/notifications" className="topbar-bell" aria-label={unread ? `Уведомления: непрочитанных ${unread}` : "Уведомления"}>
              Уведомления
              {unread ? <span className="topbar-bell__count">{unread > 99 ? "99+" : unread}</span> : null}
            </Link>
            <div>
              <div className="topbar-user-name">{session.fullName}</div>
              <div className="topbar-user-email">{session.email}</div>
            </div>
            <form action={logoutAction}>
              <button type="submit" className="btn btn-secondary btn-sm">
                Выйти
              </button>
            </form>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
