import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { updateRouteAction } from "../../actions";

const MAX_STEPS = 5;

export default async function EditPaymentApprovalRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [route, roles, organizations] = await Promise.all([
    prisma.paymentApprovalRoute.findUnique({ where: { id }, include: { steps: { orderBy: { stepOrder: "asc" } } } }),
    prisma.role.findMany({ orderBy: { name: "asc" } }),
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);
  if (!route) notFound();

  const stepRoleIds = route.steps.map((s) => s.roleId);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Маршрут: {route.name}</h1>
        <Link href="/admin/payment-approval-routes" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <p className="text-muted" style={{ marginBottom: 14 }}>
          Изменение шагов повлияет и на заявки, которые уже находятся в процессе согласования по этому маршруту —
          снимок делается только на уровне выбора маршрута для заявки, а не списка его шагов.
        </p>
        <form action={updateRouteAction.bind(null, id)}>
          <div className="form-grid">
            <label className="field">
              <span>Название *</span>
              <input type="text" name="name" defaultValue={route.name} required />
            </label>
            <label className="field">
              <span>Приоритет (меньше — раньше)</span>
              <input type="number" name="priority" defaultValue={route.priority} />
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" name="isArchived" defaultChecked={route.isArchived} />
            В архиве (не применяется)
          </label>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Когда применяется</h2>
          <div className="form-grid">
            <label className="field">
              <span>Сумма от</span>
              <input type="number" step="0.01" name="minAmount" defaultValue={route.minAmount?.toString() ?? ""} />
            </label>
            <label className="field">
              <span>Сумма до</span>
              <input type="number" step="0.01" name="maxAmount" defaultValue={route.maxAmount?.toString() ?? ""} />
            </label>
            <label className="field">
              <span>Организация</span>
              <select name="organizationId" defaultValue={route.organizationId ?? ""}>
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
                <select name={`stepRole${i + 1}`} defaultValue={stepRoleIds[i] ?? ""}>
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
              Сохранить
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
