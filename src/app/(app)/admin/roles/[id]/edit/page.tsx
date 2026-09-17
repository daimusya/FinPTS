import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/permissions";
import { updateRolePermissionsAction } from "../../actions";

export default async function EditRolePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.USERS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [role, permissions] = await Promise.all([
    prisma.role.findUnique({ where: { id }, include: { permissions: true } }),
    prisma.permission.findMany({ orderBy: { code: "asc" } }),
  ]);
  if (!role) notFound();

  const assigned = new Set(role.permissions.map((p) => p.permissionId));
  const permissionById = new Map(permissions.map((p) => [p.id, p]));
  const assignedCodes = new Set(
    [...assigned].map((permId) => permissionById.get(permId)?.code).filter(Boolean),
  );

  return (
    <div className="page">
      <div className="page-header">
        <h1>
          Роль: {role.name} {role.isSystem ? <span className="badge badge-orange">системная</span> : null}
        </h1>
        <Link href="/admin/roles" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 620 }}>
        <form action={updateRolePermissionsAction.bind(null, id)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {permissions.map((p) => (
              <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <input
                  type="checkbox"
                  name="permissionCodes"
                  value={p.code}
                  defaultChecked={assignedCodes.has(p.code)}
                />
                {PERMISSION_LABELS[p.code as keyof typeof PERMISSION_LABELS] ?? p.description}
              </label>
            ))}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить права
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
