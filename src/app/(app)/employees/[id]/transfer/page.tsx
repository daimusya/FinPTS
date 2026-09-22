import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { transferEmployeeAction } from "../../actions";

export default async function TransferEmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [employee, departments, positions] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.position.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);
  if (!employee) notFound();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Перевод: {employee.fullName}</h1>
        <Link href={`/employees/${id}`} className="btn btn-secondary">
          Назад
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={transferEmployeeAction.bind(null, id)}>
          <div className="form-grid">
            <label className="field">
              <span>Новое подразделение</span>
              <select name="departmentId" defaultValue={employee.departmentId ?? ""}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Новая должность</span>
              <select name="positionId" defaultValue={employee.positionId ?? ""}>
                <option value="">—</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дата перевода *</span>
              <input type="date" name="eventDate" required />
            </label>
          </div>
          <label className="field" style={{ marginTop: 14 }}>
            <span>Комментарий</span>
            <input type="text" name="comment" />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Перевести
            </button>
            <Link href={`/employees/${id}`} className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
