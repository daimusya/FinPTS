import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, sumMoney } from "@/lib/money";
import { SCENARIO_TYPE_LABELS } from "@/lib/financial-model/drivers";
import { projectScenario, type ScenarioValueRow } from "@/lib/financial-model/project";
import { getCurrentCashBalance } from "@/lib/financial-model/current-cash";
import { loadNewServices } from "@/lib/financial-model/new-services";
import { loadLoans, loadOpeningBalances } from "@/lib/financial-model/loans";
import { getAccessScope } from "@/lib/access-scope";

const HORIZON_MONTHS = 12;

export default async function CompareScenariosPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[]; startYear?: string; startMonth?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const allScenarios = await prisma.financialScenario.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: "desc" },
  });

  const sp = await searchParams;
  const idsParam = sp.ids ? (Array.isArray(sp.ids) ? sp.ids : [sp.ids]) : [];
  const selectedIds = idsParam.length > 0 ? idsParam : allScenarios.slice(0, 2).map((s) => s.id);

  const now = new Date();
  const startYear = Number(sp.startYear) || now.getFullYear();
  const startMonth = Number(sp.startMonth) || now.getMonth() + 1;
  // Same scoped starting balance as the scenario page — the local copy here used to ignore visibility restrictions.
  const scope = await getAccessScope(session);
  const [startingCash, opening] = await Promise.all([getCurrentCashBalance(scope), loadOpeningBalances(scope)]);

  const scenarios = await prisma.financialScenario.findMany({
    where: { id: { in: selectedIds } },
    include: { values: true },
  });
  const [newServices, loans] = await Promise.all([
    loadNewServices(scenarios.map((s) => s.id)),
    loadLoans(scenarios.map((s) => s.id)),
  ]);

  const results = scenarios.map((s) => {
    const rows: ScenarioValueRow[] = s.values.map((v) => ({
      year: v.year,
      month: v.month,
      driver: v.driver,
      dimension: v.dimension,
      value: v.value.toString(),
    }));
    const projection = projectScenario(startYear, startMonth, HORIZON_MONTHS, rows, startingCash, newServices.get(s.id) ?? [], {
      ...opening,
      loans: loans.get(s.id) ?? [],
    });
    return {
      scenario: s,
      totalRevenue: sumMoney(projection.map((p) => p.revenue)),
      totalNewServicesRevenue: sumMoney(projection.map((p) => p.newServicesRevenue)),
      newServicesCount: newServices.get(s.id)?.length ?? 0,
      totalOperatingProfit: sumMoney(projection.map((p) => p.operatingProfit)),
      totalNetProfit: sumMoney(projection.map((p) => p.netProfit)),
      finalDebt: projection[projection.length - 1]?.loanDebt ?? sumMoney([]),
      finalCash: projection[projection.length - 1]?.cashBalance ?? sumMoney([]),
      avgBreakEven: sumMoney(projection.filter((p) => p.breakEvenRevenue !== null).map((p) => p.breakEvenRevenue!)).dividedBy(
        Math.max(1, projection.filter((p) => p.breakEvenRevenue !== null).length),
      ),
    };
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Сравнение сценариев</h1>
          <p>Горизонт 12 месяцев от выбранного старта, тот же стартовый остаток денег для всех сценариев.</p>
        </div>
      </div>

      <form className="filter-bar">
        <div className="tag-list" style={{ alignItems: "center" }}>
          {allScenarios.map((s) => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" name="ids" value={s.id} defaultChecked={selectedIds.includes(s.id)} />
              {s.name} ({SCENARIO_TYPE_LABELS[s.type] ?? s.type})
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-secondary">
          Сравнить
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Показатель</th>
              {results.map((r) => (
                <th key={r.scenario.id}>{r.scenario.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Выручка за 12 месяцев</td>
              {results.map((r) => (
                <td key={r.scenario.id} className="mono">
                  {formatMoney(r.totalRevenue)}
                </td>
              ))}
            </tr>
            <tr>
              <td className="text-muted" style={{ paddingLeft: 24 }}>
                в т.ч. новые услуги
              </td>
              {results.map((r) => (
                <td key={r.scenario.id} className="mono text-muted">
                  {r.newServicesCount > 0 ? `${formatMoney(r.totalNewServicesRevenue)} (${r.newServicesCount} усл.)` : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td>Операционная прибыль за 12 месяцев</td>
              {results.map((r) => (
                <td key={r.scenario.id} className="mono">
                  {formatMoney(r.totalOperatingProfit)}
                </td>
              ))}
            </tr>
            <tr>
              <td>Прибыль после процентов по кредитам за 12 месяцев</td>
              {results.map((r) => (
                <td key={r.scenario.id} className="mono">
                  {formatMoney(r.totalNetProfit)}
                </td>
              ))}
            </tr>
            <tr>
              <td>Долг по кредитам на конец горизонта</td>
              {results.map((r) => (
                <td key={r.scenario.id} className="mono">
                  {formatMoney(r.finalDebt)}
                </td>
              ))}
            </tr>
            <tr>
              <td>Остаток денег на конец горизонта</td>
              {results.map((r) => (
                <td key={r.scenario.id} className="mono">
                  {formatMoney(r.finalCash)}
                </td>
              ))}
            </tr>
            <tr>
              <td>Средняя точка безубыточности</td>
              {results.map((r) => (
                <td key={r.scenario.id} className="mono">
                  {formatMoney(r.avgBreakEven)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        {results.length === 0 ? <div className="empty-state">Выберите хотя бы один сценарий.</div> : null}
      </div>
    </div>
  );
}
