import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/permissions";
import { createRoleAction } from "../actions";

export default async function NewRolePage({
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

  const permissions = await prisma.permission.findMany({ orderBy: { code: "asc" } });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новая роль</h1>
        <Link href="/admin/roles" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createRoleAction}>
          <label className="field">
            <span>Название роли *</span>
            <input type="text" name="name" required />
          </label>

          <div style={{ marginTop: 16 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Права</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
              {permissions.map((p) => (
                <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <input type="checkbox" name="permissionCodes" value={p.code} />
                  {PERMISSION_LABELS[p.code as keyof typeof PERMISSION_LABELS] ?? p.description}
                </label>
              ))}
            </div>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Создать роль
            </button>
            <Link href="/admin/roles" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
