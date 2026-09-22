import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { terminateEmployeeAction } from "../../actions";

export default async function TerminateEmployeePage({
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

  const employee = await prisma.employee.findUnique({ where: { id } });
  if (!employee) notFound();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Увольнение: {employee.fullName}</h1>
        <Link href={`/employees/${id}`} className="btn btn-secondary">
          Назад
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={terminateEmployeeAction.bind(null, id)}>
          <label className="field">
            <span>Дата увольнения *</span>
            <input type="date" name="eventDate" required />
          </label>
          <label className="field" style={{ marginTop: 14 }}>
            <span>Комментарий</span>
            <input type="text" name="comment" />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-danger">
              Уволить
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
