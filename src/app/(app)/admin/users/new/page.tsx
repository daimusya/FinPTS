import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createUserAction } from "../actions";

export default async function NewUserPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.USERS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const roles = await prisma.role.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новый пользователь</h1>
        <Link href="/admin/users" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createUserAction}>
          <div className="form-grid">
            <label className="field">
              <span>ФИО *</span>
              <input type="text" name="fullName" required />
            </label>
            <label className="field">
              <span>Email *</span>
              <input type="email" name="email" required />
            </label>
          </div>

          <div style={{ marginTop: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Роли</span>
            <div className="tag-list" style={{ marginTop: 8 }}>
              {roles.map((role) => (
                <label key={role.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <input type="checkbox" name="roleIds" value={role.id} />
                  {role.name}
                </label>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Создать (временный пароль будет сгенерирован)
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
