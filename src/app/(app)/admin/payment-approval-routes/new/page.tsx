import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createRouteAction } from "../actions";

const MAX_STEPS = 5;

export default async function NewPaymentApprovalRoutePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [roles, organizations] = await Promise.all([
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новый маршрут согласования</h1>
        <Link href="/admin/payment-approval-routes" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createRouteAction}>
          <div className="form-grid">
            <label className="field">
              <span>Название *</span>
              <input type="text" name="name" required />
            </label>
            <label className="field">
              <span>Приоритет (меньше — раньше)</span>
              <input type="number" name="priority" defaultValue={100} />
            </label>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Когда применяется</h2>
          <div className="form-grid">
            <label className="field">
              <span>Сумма от</span>
              <input type="number" step="0.01" name="minAmount" />
            </label>
            <label className="field">
              <span>Сумма до</span>
              <input type="number" step="0.01" name="maxAmount" />
            </label>
            <label className="field">
              <span>Организация</span>
              <select name="organizationId">
                <option value="">Любая</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName || o.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>
            Шаги согласования (по порядку, нужен хотя бы один)
          </h2>
          <div className="form-grid">
            {Array.from({ length: MAX_STEPS }, (_, i) => (
              <label className="field" key={i}>
                <span>Шаг {i + 1}</span>
                <select name={`stepRole${i + 1}`}>
                  <option value="">—</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Создать
            </button>
            <Link href="/admin/payment-approval-routes" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
