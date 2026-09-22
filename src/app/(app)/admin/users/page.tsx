import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { readFlash } from "@/lib/flash";
import { resetPasswordAction } from "./actions";

export default async function UsersPage() {
  const session = await getSession();
  const flash = await readFlash("tempPassword");
  const [forEmail, tempPassword] = flash ? flash.split("\n") : [null, null];
  if (!session || !hasPermission(session, PERMISSIONS.USERS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления пользователями.</div>
      </div>
    );
  }

  const users = await prisma.user.findMany({
    orderBy: { fullName: "asc" },
    include: { roles: { include: { role: true } } },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Пользователи</h1>
          <p>Учётные записи и назначенные роли.</p>
        </div>
        <Link href="/admin/users/new" className="btn btn-primary">
          Добавить пользователя
        </Link>
      </div>

      {tempPassword ? (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--color-orange)" }}>
          <p className="form-success">
            Временный пароль для {forEmail}: <strong className="mono">{tempPassword}</strong>
          </p>
          <p className="text-muted">Сообщите пароль пользователю лично. Он не будет показан повторно.</p>
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ФИО</th>
              <th>Email</th>
              <th>Роли</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.fullName}</td>
                <td className="mono">{user.email}</td>
                <td>
                  <div className="tag-list">
                    {user.roles.map((r) => (
                      <span className="badge badge-orange" key={r.roleId}>
                        {r.role.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`badge ${user.isActive ? "badge-active" : "badge-archived"}`}>
                    {user.isActive ? "Активен" : "Отключён"}
                  </span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Link href={`/admin/users/${user.id}/edit`} className="btn btn-ghost btn-sm">
                      Изменить
                    </Link>
                    <form action={resetPasswordAction.bind(null, user.id)}>
                      <button type="submit" className="btn btn-ghost btn-sm">
                        Сбросить пароль
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
