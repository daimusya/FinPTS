import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { EMPLOYEE_STATUS_BADGE, EMPLOYEE_STATUS_LABELS } from "@/lib/payroll/labels";

export default async function EmployeesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра сотрудников.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.PAYROLL_MANAGE);

  const employees = await prisma.employee.findMany({
    orderBy: { fullName: "asc" },
    include: { organization: true, department: true, position: true },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Сотрудники</h1>
          <p>Приём, перевод и увольнение сохраняют кадровую историю.</p>
        </div>
        {canManage ? (
          <Link href="/employees/new" className="btn btn-primary">
            Принять сотрудника
          </Link>
        ) : null}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ФИО</th>
              <th>Организация</th>
              <th>Подразделение</th>
              <th>Должность</th>
              <th>Дата приёма</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id}>
                <td>
                  <Link href={`/employees/${e.id}`}>{e.fullName}</Link>
                </td>
                <td>{e.organization.shortName || e.organization.name}</td>
                <td>{e.department?.name ?? "—"}</td>
                <td>{e.position?.name ?? "—"}</td>
                <td className="mono">{e.hireDate.toLocaleDateString("ru-RU")}</td>
                <td>
                  <span className={`badge ${EMPLOYEE_STATUS_BADGE[e.status]}`}>{EMPLOYEE_STATUS_LABELS[e.status]}</span>
                </td>
              </tr>
            ))}
            {employees.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  Сотрудников пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
