import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { updateUserAction, updateUserAccessScopeAction } from "../../actions";

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

  const [user, roles, organizations, departments, projects, orgAccess, deptAccess, projAccess] = await Promise.all([
    prisma.user.findUnique({ where: { id }, include: { roles: true } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.userOrganizationAccess.findMany({ where: { userId: id } }),
    prisma.userDepartmentAccess.findMany({ where: { userId: id } }),
    prisma.userProjectAccess.findMany({ where: { userId: id } }),
  ]);
  if (!user) notFound();

  const assignedRoleIds = new Set(user.roles.map((r) => r.roleId));
  const assignedOrgIds = new Set(orgAccess.map((a) => a.organizationId));
  const assignedDeptIds = new Set(deptAccess.map((a) => a.departmentId));
  const assignedProjectIds = new Set(projAccess.map((a) => a.projectId));

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

      <div className="card" style={{ maxWidth: 560, marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Ограничение видимости</h2>
        <p className="text-muted" style={{ marginBottom: 14 }}>
          Пока в разрезе ничего не отмечено, он не ограничен — пользователь видит все записи. Отметьте
          организации/подразделения/проекты, чтобы пользователь видел только их (в остальных разрезах
          ограничение можно не задавать).
        </p>
        <form action={updateUserAccessScopeAction.bind(null, id)}>
          <div className="form-grid">
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Организации</span>
              <div className="tag-list" style={{ marginTop: 8, flexDirection: "column", alignItems: "flex-start" }}>
                {organizations.map((o) => (
                  <label key={o.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input type="checkbox" name="organizationIds" value={o.id} defaultChecked={assignedOrgIds.has(o.id)} />
                    {o.shortName || o.name}
                  </label>
                ))}
                {organizations.length === 0 ? <span className="text-muted">Организаций пока нет.</span> : null}
              </div>
            </div>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Подразделения</span>
              <div className="tag-list" style={{ marginTop: 8, flexDirection: "column", alignItems: "flex-start" }}>
                {departments.map((d) => (
                  <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input type="checkbox" name="departmentIds" value={d.id} defaultChecked={assignedDeptIds.has(d.id)} />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Проекты</span>
              <div className="tag-list" style={{ marginTop: 8, flexDirection: "column", alignItems: "flex-start" }}>
                {projects.map((p) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input type="checkbox" name="projectIds" value={p.id} defaultChecked={assignedProjectIds.has(p.id)} />
                    {p.name}
                  </label>
                ))}
                {projects.length === 0 ? <span className="text-muted">Проектов пока нет.</span> : null}
              </div>
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-secondary">
              Сохранить ограничение видимости
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
