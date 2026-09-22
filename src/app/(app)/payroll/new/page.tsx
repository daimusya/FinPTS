import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createPayrollRunAction } from "../actions";

export default async function NewPayrollRunPage({
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

  const organizations = await prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } });

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новый расчёт зарплаты</h1>
        <Link href="/payroll" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createPayrollRunAction}>
          <div className="form-grid">
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
              <span>Вид расчёта *</span>
              <select name="kind" required>
                <option value="ADVANCE">Аванс (25 число)</option>
                <option value="FINAL">Окончательный расчёт (10 число)</option>
                <option value="ADHOC">Разовый расчёт</option>
              </select>
            </label>
            <label className="field">
              <span>Дата выплаты *</span>
              <input type="date" name="payoutDate" required />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Создать
            </button>
            <Link href="/payroll" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
