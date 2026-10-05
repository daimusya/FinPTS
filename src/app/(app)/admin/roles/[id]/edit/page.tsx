import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/permissions";
import { deleteRoleAction, renameRoleAction, updateRolePermissionsAction } from "../../actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { roleDeleteProblem } from "@/lib/roles";

export default async function EditRolePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.USERS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [role, permissions] = await Promise.all([
    prisma.role.findUnique({
      where: { id },
      include: { permissions: true, users: { include: { user: { select: { fullName: true } } } }, approvalSteps: { include: { route: { select: { name: true } } } } },
    }),
    prisma.permission.findMany({ orderBy: { code: "asc" } }),
  ]);
  if (!role) notFound();
  const holders = role.users.map((u) => u.user.fullName).sort((a, b) => a.localeCompare(b, "ru"));
  const routeNames = [...new Set(role.approvalSteps.map((s) => s.route.name))];
  const deleteProblem = roleDeleteProblem({ isSystem: role.isSystem, userCount: holders.length, routeNames });

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

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p className="form-success" style={{ marginBottom: 14 }}>{notice}</p> : null}

      {!role.isSystem ? (
        <div className="card" style={{ maxWidth: 620, marginBottom: 16 }}>
          <form action={renameRoleAction.bind(null, id)} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field" style={{ flex: "1 1 260px" }}>
              <span>Название роли</span>
              <input type="text" name="name" id="role-name" defaultValue={role.name} required maxLength={100} />
            </label>
            <button type="submit" className="btn btn-secondary">
              Переименовать
            </button>
          </form>
        </div>
      ) : null}

      <div className="card" style={{ maxWidth: 620, marginBottom: 16 }}>
        <p style={{ fontSize: 13, margin: 0 }}>
          <strong>Назначена:</strong> {holders.length > 0 ? holders.join(", ") : <span className="text-muted">никому</span>}
        </p>
        {routeNames.length > 0 ? (
          <p style={{ fontSize: 13, margin: "6px 0 0" }}>
            <strong>Маршруты согласования:</strong> {routeNames.join(", ")}
          </p>
        ) : null}
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

      {!role.isSystem ? (
        <div className="card" style={{ maxWidth: 620, marginTop: 16 }}>
          {deleteProblem ? (
            <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
              Удалить роль сейчас нельзя: {deleteProblem.charAt(0).toLowerCase() + deleteProblem.slice(1)}.
            </p>
          ) : (
            <form action={deleteRoleAction.bind(null, id)}>
              <ConfirmSubmitButton className="btn btn-ghost" message={`Удалить роль «${role.name}»? Её права будут удалены вместе с ней.`}>
                Удалить роль
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
