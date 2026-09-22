import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { hireEmployeeAction } from "../actions";

export default async function NewEmployeePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [organizations, departments, positions, workSchedules] = await Promise.all([
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.position.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.workSchedule.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Приём сотрудника</h1>
        <Link href="/employees" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 640 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={hireEmployeeAction}>
          <div className="form-grid">
            <label className="field">
              <span>ФИО *</span>
              <input type="text" name="fullName" required />
            </label>
            <label className="field">
              <span>Табельный номер</span>
              <input type="text" name="personnelNumber" />
            </label>
            <label className="field">
              <span>Организация *</span>
              <select name="organizationId" required>
                <option value="">— выбрать —</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName || o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Подразделение</span>
              <select name="departmentId">
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Должность</span>
              <select name="positionId">
                <option value="">—</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>График работы</span>
              <select name="workScheduleId">
                <option value="">—</option>
                {workSchedules.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дата приёма *</span>
              <input type="date" name="hireDate" required />
            </label>
            <label className="field">
              <span>Оклад</span>
              <input type="number" step="0.01" name="salary" />
            </label>
            <label className="field">
              <span>Способ выплаты</span>
              <select name="paymentMethod" defaultValue="BANK">
                <option value="CASH">Наличный</option>
                <option value="BANK">Безналичный</option>
                <option value="MIXED">Смешанный</option>
              </select>
            </label>
            <label className="field">
              <span>Банковские реквизиты</span>
              <input type="text" name="bankAccount" />
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Принять
            </button>
            <Link href="/employees" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
