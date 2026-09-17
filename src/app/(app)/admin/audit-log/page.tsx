import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string }>;
}) {
  const session = await getSession();
  const { entityType } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.AUDIT_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра журнала аудита.</div>
      </div>
    );
  }

  const entries = await prisma.auditLog.findMany({
    where: entityType ? { entityType } : undefined,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { user: true },
  });

  const entityTypes = await prisma.auditLog.findMany({
    distinct: ["entityType"],
    select: { entityType: true },
    orderBy: { entityType: "asc" },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Журнал аудита</h1>
          <p>Последние 300 записей об изменениях финансовых и административных данных.</p>
        </div>
      </div>

      <form className="filter-bar">
        <label className="field" style={{ minWidth: 220 }}>
          <span>Тип сущности</span>
          <select name="entityType" defaultValue={entityType ?? ""}>
            <option value="">Все</option>
            {entityTypes.map((e) => (
              <option key={e.entityType} value={e.entityType}>
                {e.entityType}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">
          Применить
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Пользователь</th>
              <th>Сущность</th>
              <th>ID</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="mono">{entry.createdAt.toLocaleString("ru-RU")}</td>
                <td>{entry.user?.fullName ?? "система"}</td>
                <td>{entry.entityType}</td>
                <td className="mono">{entry.entityId}</td>
                <td>
                  <span className="badge badge-orange">{entry.action}</span>
                </td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  Записей пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
