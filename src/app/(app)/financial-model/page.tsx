import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { SCENARIO_TYPE_LABELS } from "@/lib/financial-model/drivers";
import { archiveScenarioAction } from "./actions";

export default async function FinancialModelPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра финансового моделирования.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const scenarios = await prisma.financialScenario.findMany({
    orderBy: { createdAt: "desc" },
    include: { values: true },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Финансовое моделирование</h1>
          <p>Сценарии на 12+ месяцев: выручка, расходы, прибыль, остаток денег, точка безубыточности.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {scenarios.length >= 2 ? (
            <Link href="/financial-model/compare" className="btn btn-secondary">
              Сравнить сценарии
            </Link>
          ) : null}
          {canManage ? (
            <Link href="/financial-model/new" className="btn btn-primary">
              Новый сценарий
            </Link>
          ) : null}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Тип</th>
              <th>Заполнено месяцев</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const months = new Set(s.values.map((v) => `${v.year}-${v.month}`)).size;
              return (
                <tr key={s.id}>
                  <td>
                    <Link href={`/financial-model/${s.id}`}>{s.name}</Link>
                  </td>
                  <td>{SCENARIO_TYPE_LABELS[s.type] ?? s.type}</td>
                  <td>{months}</td>
                  <td>
                    <span className={`badge ${s.isArchived ? "badge-archived" : "badge-active"}`}>
                      {s.isArchived ? "В архиве" : "Активен"}
                    </span>
                  </td>
                  <td>
                    {canManage && !s.isArchived ? (
                      <form action={archiveScenarioAction.bind(null, s.id)}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          В архив
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {scenarios.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  Сценариев пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
