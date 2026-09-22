import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { EMPLOYEE_STATUS_BADGE, EMPLOYEE_STATUS_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/payroll/labels";
import { formatMoney } from "@/lib/money";
import { setProjectAllocationAction, removeProjectAllocationAction } from "../actions";

const EVENT_TYPE_LABELS: Record<string, string> = {
  hire: "Приём",
  transfer: "Перевод",
  termination: "Увольнение",
};

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.PAYROLL_MANAGE);

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      organization: true,
      department: true,
      position: true,
      workSchedule: true,
      employmentHist: { orderBy: { eventDate: "desc" }, include: { fromDepartment: true, toDepartment: true, fromPosition: true, toPosition: true } },
      projectAlloc: { where: { validTo: null }, include: { project: true } },
    },
  });
  if (!employee) notFound();

  const projects = await prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{employee.fullName}</h1>
          <p>
            {employee.organization.shortName || employee.organization.name} · {employee.department?.name ?? "без подразделения"} ·{" "}
            {employee.position?.name ?? "без должности"}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/employees" className="btn btn-secondary">
            К списку
          </Link>
          {canManage && employee.status !== "TERMINATED" ? (
            <>
              <Link href={`/employees/${id}/edit`} className="btn btn-secondary">
                Изменить
              </Link>
              <Link href={`/employees/${id}/transfer`} className="btn btn-secondary">
                Перевести
              </Link>
              <Link href={`/employees/${id}/terminate`} className="btn btn-danger">
                Уволить
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Статус</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            <span className={`badge ${EMPLOYEE_STATUS_BADGE[employee.status]}`}>{EMPLOYEE_STATUS_LABELS[employee.status]}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Оклад</div>
          <div className="stat-value">{employee.salary ? formatMoney(employee.salary) : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Способ выплаты</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {PAYMENT_METHOD_LABELS[employee.paymentMethod]}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">График работы</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            {employee.workSchedule?.name ?? "—"}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Распределение по проектам</h2>
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Проект</th>
                <th>Доля занятости</th>
                <th>С даты</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employee.projectAlloc.map((a) => (
                <tr key={a.id}>
                  <td>{a.project.name}</td>
                  <td className="mono">{Number(a.sharePct)}%</td>
                  <td className="mono">{a.validFrom.toLocaleDateString("ru-RU")}</td>
                  <td>
                    {canManage ? (
                      <form action={removeProjectAllocationAction.bind(null, id, a.id)}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Снять
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {employee.projectAlloc.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Не распределён по проектам — вся занятость на подразделение.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <form action={setProjectAllocationAction.bind(null, id)} className="form-grid" style={{ alignItems: "flex-end" }}>
            <label className="field">
              <span>Проект</span>
              <select name="projectId" required>
                <option value="">— выбрать —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Доля занятости, %</span>
              <input type="number" step="1" min="1" max="100" name="sharePct" required />
            </label>
            <button type="submit" className="btn btn-secondary">
              Добавить
            </button>
          </form>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Кадровая история</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Событие</th>
                <th>Подразделение</th>
                <th>Должность</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {employee.employmentHist.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.eventDate.toLocaleDateString("ru-RU")}</td>
                  <td>
                    <span className="badge badge-orange">{EVENT_TYPE_LABELS[h.eventType] ?? h.eventType}</span>
                  </td>
                  <td>
                    {h.fromDepartment && h.toDepartment && h.fromDepartment.id !== h.toDepartment.id
                      ? `${h.fromDepartment.name} → ${h.toDepartment.name}`
                      : h.toDepartment?.name ?? "—"}
                  </td>
                  <td>
                    {h.fromPosition && h.toPosition && h.fromPosition.id !== h.toPosition.id
                      ? `${h.fromPosition.name} → ${h.toPosition.name}`
                      : h.toPosition?.name ?? "—"}
                  </td>
                  <td>{h.comment ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
