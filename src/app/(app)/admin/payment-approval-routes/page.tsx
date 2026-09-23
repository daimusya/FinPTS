import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";

export default async function PaymentApprovalRoutesPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра маршрутов согласования.</div>
      </div>
    );
  }

  const routes = await prisma.paymentApprovalRoute.findMany({
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    include: { steps: { include: { role: true }, orderBy: { stepOrder: "asc" } }, organization: true },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Маршруты согласования заявок на оплату</h1>
          <p>
            Маршрут применяется, если сумма заявки попадает в диапазон и организация совпадает (пусто — без
            ограничения). Среди подходящих маршрутов действует наименьший приоритет. Если ни один не подошёл —
            заявка идёт по старому одноступенчатому согласованию.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin/payment-approval-routes/new" className="btn btn-primary">
            Новый маршрут
          </Link>
          <Link href="/payment-requests" className="btn btn-secondary">
            К заявкам
          </Link>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Приоритет</th>
              <th>Название</th>
              <th>Условия</th>
              <th>Шаги</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => {
              const conditions: string[] = [];
              if (route.organization) conditions.push(route.organization.shortName || route.organization.name);
              if (route.minAmount) conditions.push(`от ${formatMoney(route.minAmount)}`);
              if (route.maxAmount) conditions.push(`до ${formatMoney(route.maxAmount)}`);
              return (
                <tr key={route.id}>
                  <td className="mono">{route.priority}</td>
                  <td>{route.name}</td>
                  <td>{conditions.length > 0 ? conditions.join(", ") : "любая заявка"}</td>
                  <td>{route.steps.map((s) => s.role.name).join(" → ")}</td>
                  <td>
                    <span className={`badge ${route.isArchived ? "badge-danger" : "badge-active"}`}>
                      {route.isArchived ? "В архиве" : "Активен"}
                    </span>
                  </td>
                  <td>
                    <Link href={`/admin/payment-approval-routes/${route.id}/edit`} className="btn btn-ghost btn-sm">
                      Изменить
                    </Link>
                  </td>
                </tr>
              );
            })}
            {routes.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  Маршрутов пока нет — все заявки согласуются одной ступенью.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
