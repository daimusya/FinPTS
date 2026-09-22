import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { updateEmployeeAction } from "../../actions";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [employee, workSchedules] = await Promise.all([
    prisma.employee.findUnique({ where: { id } }),
    prisma.workSchedule.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);
  if (!employee) notFound();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Изменить: {employee.fullName}</h1>
        <Link href={`/employees/${id}`} className="btn btn-secondary">
          Назад
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <form action={updateEmployeeAction.bind(null, id)}>
          <div className="form-grid">
            <label className="field">
              <span>Табельный номер</span>
              <input type="text" name="personnelNumber" defaultValue={employee.personnelNumber ?? ""} />
            </label>
            <label className="field">
              <span>График работы</span>
              <select name="workScheduleId" defaultValue={employee.workScheduleId ?? ""}>
                <option value="">—</option>
                {workSchedules.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Оклад</span>
              <input type="number" step="0.01" name="salary" defaultValue={employee.salary ? String(employee.salary) : ""} />
            </label>
            <label className="field">
              <span>Способ выплаты</span>
              <select name="paymentMethod" defaultValue={employee.paymentMethod}>
                <option value="CASH">Наличный</option>
                <option value="BANK">Безналичный</option>
                <option value="MIXED">Смешанный</option>
              </select>
            </label>
            <label className="field">
              <span>Банковские реквизиты</span>
              <input type="text" name="bankAccount" defaultValue={employee.bankAccount ?? ""} />
            </label>
          </div>
          <p className="text-muted" style={{ marginTop: 12 }}>
            Подразделение и должность меняются через «Перевести» — так сохраняется кадровая история.
          </p>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить
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
