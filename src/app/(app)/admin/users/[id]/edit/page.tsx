import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { updateUserAction } from "../../actions";

export default async function EditUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.USERS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [user, roles] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { roles: true } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
  ]);
  if (!user) notFound();

  const assignedRoleIds = new Set(user.roles.map((r) => r.roleId));

  return (
    <div className="page">
      <div className="page-header">
        <h1>Пользователь: {user.fullName}</h1>
        <Link href="/admin/users" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={updateUserAction.bind(null, id)}>
          <div className="form-grid">
            <label className="field">
              <span>ФИО *</span>
              <input type="text" name="fullName" defaultValue={user.fullName} required />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={user.email} disabled />
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" name="isActive" defaultChecked={user.isActive} />
            Учётная запись активна
          </label>

          <div style={{ marginTop: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Роли</span>
            <div className="tag-list" style={{ marginTop: 8 }}>
              {roles.map((role) => (
                <label key={role.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={role.id}
                    defaultChecked={assignedRoleIds.has(role.id)}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить
            </button>
            <Link href="/admin/users" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
