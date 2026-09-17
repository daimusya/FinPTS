import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "./actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <header className="topbar">
          <div />
          <div className="topbar-user">
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
