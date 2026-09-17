import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";

export default async function RolesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.USERS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления ролями.</div>
      </div>
    );
  }

  const roles = await prisma.role.findMany({
    orderBy: { name: "asc" },
    include: { permissions: { include: { permission: true } }, users: true },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Роли и права</h1>
          <p>Настройка ролей и связанных с ними прав доступа.</p>
        </div>
        <Link href="/admin/roles/new" className="btn btn-primary">
          Новая роль
        </Link>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Роль</th>
              <th>Код</th>
              <th>Пользователей</th>
              <th>Права</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.id}>
                <td>{role.name}</td>
                <td className="mono">{role.code}</td>
                <td>{role.users.length}</td>
                <td>
                  <div className="tag-list">
                    {role.permissions.map((p) => (
                      <span className="badge badge-orange" key={p.permissionId}>
                        {p.permission.code}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <Link href={`/admin/roles/${role.id}/edit`} className="btn btn-ghost btn-sm">
                    Права
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
