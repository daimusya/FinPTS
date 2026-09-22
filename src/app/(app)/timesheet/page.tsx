import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { TIME_SHEET_DAY_TYPE_LABELS } from "@/lib/payroll/labels";
import { bulkFillTimesheetAction, deleteTimesheetEntryAction } from "./actions";

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: Promise<{ employeeId?: string; year?: string; month?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра табеля.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.PAYROLL_MANAGE);

  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getFullYear();
  const month = Number(sp.month) || now.getMonth() + 1;
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59));

  const [employees, projects] = await Promise.all([
    prisma.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { fullName: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);

  const entries = sp.employeeId
    ? await prisma.timeSheet.findMany({
        where: { employeeId: sp.employeeId, date: { gte: from, lte: to } },
        orderBy: { date: "asc" },
        include: { project: true },
      })
    : [];

  const totalHours = entries.reduce((acc, e) => acc + Number(e.hours), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Табель</h1>
          <p>Рабочие дни, отпуска, больничные и проектные часы. Данные используются при расчёте зарплаты.</p>
        </div>
      </div>

      {canManage ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Массовое заполнение</h2>
          <form action={bulkFillTimesheetAction}>
            <div className="form-grid">
              <label className="field">
                <span>Дата с *</span>
                <input type="date" name="dateFrom" required />
              </label>
              <label className="field">
                <span>Дата по *</span>
                <input type="date" name="dateTo" required />
              </label>
              <label className="field">
                <span>Тип дня *</span>
                <select name="dayType" required>
                  {Object.entries(TIME_SHEET_DAY_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Часов в день</span>
                <input type="number" step="0.5" name="hours" defaultValue="8" />
              </label>
              <label className="field">
                <span>Проект (для проектных часов)</span>
                <select name="projectId">
                  <option value="">—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13 }}>
              <input type="checkbox" name="skipWeekends" defaultChecked />
              Пропускать субботу и воскресенье
            </label>
            <div style={{ marginTop: 12 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Сотрудники</span>
              <div className="tag-list" style={{ marginTop: 8, maxHeight: 160, overflowY: "auto" }}>
                {employees.map((e) => (
                  <label key={e.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input type="checkbox" name="employeeIds" value={e.id} />
                    {e.fullName}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Заполнить
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Просмотр табеля</h2>
        <form className="filter-bar">
          <label className="field">
            <span>Сотрудник</span>
            <select name="employeeId" defaultValue={sp.employeeId ?? ""}>
              <option value="">— выбрать —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Год</span>
            <input type="number" name="year" defaultValue={year} style={{ width: 90 }} />
          </label>
          <label className="field">
            <span>Месяц</span>
            <input type="number" name="month" min="1" max="12" defaultValue={month} style={{ width: 70 }} />
          </label>
          <button type="submit" className="btn btn-secondary">
            Показать
          </button>
        </form>

        {sp.employeeId ? (
          <>
            <p className="text-muted" style={{ marginBottom: 10 }}>
              Всего часов за период: <strong>{totalHours}</strong>
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Тип дня</th>
                    <th>Часы</th>
                    <th>Проект</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="mono">{entry.date.toLocaleDateString("ru-RU")}</td>
                      <td>{TIME_SHEET_DAY_TYPE_LABELS[entry.dayType] ?? entry.dayType}</td>
                      <td className="mono">{Number(entry.hours)}</td>
                      <td>{entry.project?.name ?? "—"}</td>
                      <td>
                        {canManage ? (
                          <form action={deleteTimesheetEntryAction.bind(null, entry.id)}>
                            <button type="submit" className="btn btn-ghost btn-sm">
                              Удалить
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-state">
                        Записей за период нет.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="text-muted">Выберите сотрудника, чтобы увидеть табель.</p>
        )}
      </div>
    </div>
  );
}
