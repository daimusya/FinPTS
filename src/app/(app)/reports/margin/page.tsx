import Link from "next/link";
import type Decimal from "decimal.js";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatNumber } from "@/lib/money";
import { periodMonths, periodQuery, resolveReportPeriod } from "@/lib/reports/period";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import {
  computeMarginReport,
  INDIRECT_DRIVER_LABELS,
  INDIRECT_DRIVER_OPTIONS,
  marginPlanTotals,
  type DimensionMarginRow,
  type IndirectDriver,
  type MarginTotals,
} from "@/lib/reports/margin";
import { ReportFilterBar } from "@/components/report-filter-bar";
import { getAccessScope } from "@/lib/access-scope";
import { loadPlanByProject, loadPlanItems } from "@/lib/budget/load";
import { planFactMetrics, resolvePlanAvailability } from "@/lib/budget/plan-fact";
import { budgetDim, planSliceNote } from "@/lib/budget/report-links";
import { PLAN_FACT_HEADERS, PlanFactCells } from "@/components/plan-fact-cells";
import { mergeProjectPlan, type ProjectPlanRow } from "@/lib/reports/margin-plan";
import { singleParams } from "@/lib/query-params";
import { canExportReport } from "@/lib/reports/export-access";

export default async function MarginReportPage({
  searchParams,
}: {
  searchParams: Promise<ReportSearchParams & { driver?: string; compare?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.REPORTS_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра отчёта.</div>
      </div>
    );
  }

  const sp = singleParams(await searchParams);
  const period = resolveReportPeriod(sp);
  const filters = extractFilters(sp);
  const scope = await getAccessScope(session);
  const driver: IndirectDriver = INDIRECT_DRIVER_OPTIONS.includes(sp.driver as IndirectDriver)
    ? (sp.driver as IndirectDriver)
    : "revenue";
  const comparePlan = sp.compare === "plan";
  const availability = resolvePlanAvailability(filters, scope);
  // Plans by project exist only without another dimension in the filter (a plan entry has one dimension).
  const projectPlanAvailable = availability.available && (!availability.slice.dimension || availability.slice.dimension.field === "projectId");

  const [report, planItems, projectPlan] = await Promise.all([
    computeMarginReport(period, filters, scope, driver),
    comparePlan && availability.available ? loadPlanItems("PNL", periodMonths(period), availability.slice) : Promise.resolve([]),
    comparePlan && projectPlanAvailable && availability.available
      ? loadPlanByProject(periodMonths(period), availability.slice.organizationIds)
      : Promise.resolve(null),
  ]);
  const plan = comparePlan ? marginPlanTotals(planItems) : null;
  const projectRows: ProjectPlanRow[] = mergeProjectPlan(report.byProject, projectPlan, filters.projectId ?? null);
  const showProjectPlan = Boolean(projectPlan && projectPlan.size > 0);
  const budgetHref = `/budget?kind=pnl&year=${period.year}${filters.organizationId ? `&org=${filters.organizationId}` : ""}${budgetDim(filters)}`;
  const exportParams = new URLSearchParams({ type: "margin", driver, ...(comparePlan ? { compare: "plan" } : {}) });
  for (const [key, value] of Object.entries(filters)) if (value) exportParams.set(key, String(value));
  const exportHref = `/api/reports/export?${periodQuery(period)}&${exportParams.toString()}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Маржинальность и точка безубыточности</h1>
          <p>
            Период: {period.label}. Точка безубыточности = Постоянные затраты / Доля маржинального дохода.
            Косвенные расходы по проектам/продуктам/клиентам обычно не заведены напрямую — распределяются между
            ними по выбранному ниже драйверу, настраиваемому на лету. Суммы — без НДС (у расходов — если он принимается к вычету).
            Амортизация и проценты по займам входят в итоги так же, как в ОПиУ; у них нет проекта, продукта и клиента,
            поэтому в таблицы ниже они попадают только через распределение косвенных расходов.
          </p>
        </div>
        {canExportReport(session.permissions, "margin") ? (
          <a href={exportHref} className="btn btn-secondary">
            Экспорт в Excel
          </a>
        ) : null}
      </div>

      <ReportFilterBar values={{ year: period.year, month: period.month, span: period.span, ...filters }}>
        <label className="field">
          <span>Драйвер косвенных расходов</span>
          <select name="driver" defaultValue={driver}>
            {INDIRECT_DRIVER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {INDIRECT_DRIVER_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Сравнить с планом</span>
          <select name="compare" defaultValue={comparePlan ? "plan" : ""}>
            <option value="">Нет</option>
            <option value="plan">С планом (бюджетом)</option>
          </select>
        </label>
      </ReportFilterBar>

      {comparePlan ? (
        <div className="card" style={{ marginBottom: 16 }}>
          {!availability.available ? (
            <p className="text-muted">{availability.reason}</p>
          ) : plan ? (
            <p className="text-muted">
              План из раздела <Link href={budgetHref}>«Бюджет»</Link>
              {planSliceNote(filters)}
              {period.span && period.span !== "month" ? ` — сумма помесячного плана за ${period.label}` : ""}. Плановая точка
              безубыточности — по плановым выручке, переменным и постоянным расходам. Отклонение = факт − план; зелёным — в
              пользу компании.
              {projectPlanAvailable
                ? showProjectPlan
                  ? " По проектам — план, заданный в бюджете с разрезом «проект»."
                  : " Плана с разрезом «проект» на период нет — по проектам сравнения нет."
                : " По проектам план не сравнивается: в фильтре выбрано подразделение или ЦФО."}
              {" "}По продуктам и клиентам плана нет — бюджет задаётся по статьям и разрезам подразделение / ЦФО / проект.
            </p>
          ) : (
            <p className="text-muted">
              План на {period.label} по выручке и расходам не задан — заполните его в разделе{" "}
              <Link href={budgetHref}>«Бюджет»</Link>.
            </p>
          )}
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Выручка" value={formatMoney(report.revenue)} plan={plan ? formatMoney(plan.revenue) : null} />
        <StatCard label="Валовая прибыль" value={formatMoney(report.grossProfit)} plan={plan ? formatMoney(plan.grossProfit) : null} />
        <StatCard label="Валовая маржинальность" value={pct(report.grossMarginPct)} plan={plan ? pct(plan.grossMarginPct) : null} />
        <StatCard label="Операционная прибыль" value={formatMoney(report.operatingProfit)} plan={plan ? formatMoney(plan.operatingProfit) : null} />
        <StatCard
          label="Точка безубыточности"
          value={report.breakEvenRevenue ? formatMoney(report.breakEvenRevenue) : "—"}
          plan={plan ? (plan.breakEvenRevenue ? formatMoney(plan.breakEvenRevenue) : "—") : null}
        />
        <StatCard label="Запас финансовой прочности" value={pct(report.marginOfSafetyPct)} plan={plan ? pct(plan.marginOfSafetyPct) : null} />
      </div>

      {plan ? <PlanFactTable fact={report} plan={plan} /> : null}

      <DimensionTable title="По проектам" rows={projectRows} showPlan={showProjectPlan} />
      <DimensionTable title="По продуктам и услугам" rows={report.byProductService} />
      <DimensionTable title="По клиентам" rows={report.byCounterparty} />
    </div>
  );
}

const pct = (v: Decimal | null) => (v ? `${formatNumber(v)}%` : "—");

function StatCard({ label, value, plan }: { label: string; value: string; plan: string | null }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {plan !== null ? <div className="text-muted">план {plan}</div> : null}
    </div>
  );
}

function PlanFactTable({ fact, plan }: { fact: MarginTotals; plan: MarginTotals }) {
  const money: Array<[string, keyof MarginTotals, "income" | "expense", boolean?]> = [
    ["Выручка", "revenue", "income"],
    ["Прямые переменные расходы", "directVariable", "expense"],
    ["Прямые постоянные расходы", "directFixed", "expense"],
    ["Валовая прибыль", "grossProfit", "income", true],
    ["Косвенные расходы", "indirect", "expense"],
    ["Операционная прибыль", "operatingProfit", "income", true],
    ["Точка безубыточности", "breakEvenRevenue", "expense"],
  ];
  const rates: Array<[string, keyof MarginTotals]> = [
    ["Валовая маржинальность", "grossMarginPct"],
    ["Операционная маржинальность", "operatingMarginPct"],
    ["Запас финансовой прочности", "marginOfSafetyPct"],
  ];
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>План-факт</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Показатель</th>
              <th>Факт</th>
              {PLAN_FACT_HEADERS.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {money.map(([label, key, nature, bold]) => {
              const f = fact[key] as Decimal | null;
              const p = plan[key] as Decimal | null;
              return (
                <tr key={key} style={{ fontWeight: bold ? 700 : 400 }}>
                  <td>{label}</td>
                  <td className="mono">{f ? formatMoney(f) : "—"}</td>
                  {f ? <PlanFactCells metrics={planFactMetrics(f, p)} nature={nature} bold={bold} /> : <td colSpan={3} className="text-muted">—</td>}
                </tr>
              );
            })}
            {rates.map(([label, key]) => {
              const f = fact[key] as Decimal | null;
              const p = plan[key] as Decimal | null;
              const diff = f && p ? f.minus(p) : null;
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td className="mono">{pct(f)}</td>
                  <td className="mono">{pct(p)}</td>
                  <td className={`mono ${diff ? (diff.greaterThanOrEqualTo(0) ? "text-good" : "text-bad") : ""}`}>
                    {diff ? `${diff.greaterThan(0) ? "+" : ""}${formatNumber(diff)} п.п.` : "—"}
                  </td>
                  <td />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DimensionTable({ title, rows, showPlan }: { title: string; rows: Array<DimensionMarginRow | ProjectPlanRow>; showPlan?: boolean }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Выручка</th>
              {showPlan ? <th>План выручки</th> : null}
              <th>Прямые затраты</th>
              <th>Валовая прибыль</th>
              {showPlan ? (
                <>
                  <th>План валовой прибыли</th>
                  <th>Отклонение</th>
                </>
              ) : null}
              <th>Маржинальность</th>
              <th>Косвенные (аллокация)</th>
              <th>Операционная прибыль</th>
              <th>Опер. маржинальность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const planned = "plan" in row ? row.plan : null;
              const deviation = planned ? row.grossProfit.minus(planned.grossProfit) : null;
              return (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td className="mono">{formatMoney(row.revenue)}</td>
                  {showPlan ? <td className="mono">{planned ? formatMoney(planned.revenue) : "—"}</td> : null}
                  <td className="mono">{formatMoney(row.directCost)}</td>
                  <td className="mono">{formatMoney(row.grossProfit)}</td>
                  {showPlan ? (
                    <>
                      <td className="mono">{planned ? formatMoney(planned.grossProfit) : "—"}</td>
                      <td className={`mono ${deviation ? (deviation.greaterThanOrEqualTo(0) ? "text-good" : "text-bad") : ""}`}>
                        {deviation ? `${deviation.greaterThan(0) ? "+" : ""}${formatMoney(deviation)}` : "—"}
                      </td>
                    </>
                  ) : null}
                  <td className="mono">{pct(row.grossMarginPct)}</td>
                  <td className="mono">{formatMoney(row.allocatedIndirect)}</td>
                  <td className="mono">{formatMoney(row.operatingProfit)}</td>
                  <td className="mono">{pct(row.operatingMarginPct)}</td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showPlan ? 11 : 8} className="empty-state">
                  Нет данных за период.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
