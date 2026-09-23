import Link from "next/link";
import { Fragment } from "react";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatNumber } from "@/lib/money";
import { resolveReportPeriod, previousPeriod } from "@/lib/reports/period";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import {
  computePnlReport,
  derivePnlTotals,
  PNL_INCOME_TYPES,
  PNL_TYPE_LABELS as TYPE_LABELS,
  PNL_TYPE_ORDER,
  type PnlArticleRow,
  type PnlType,
} from "@/lib/reports/pnl";
import { ReportFilterBar } from "@/components/report-filter-bar";
import { getAccessScope } from "@/lib/access-scope";
import { toDecimal } from "@/lib/money";
import { loadPlanItems } from "@/lib/budget/load";
import {
  mergePlanIntoRows,
  planFactMetrics,
  planTotal,
  resolvePlanAvailability,
  type PlanFactMetrics,
} from "@/lib/budget/plan-fact";
import { PLAN_FACT_HEADERS, PlanFactCells } from "@/components/plan-fact-cells";
import type Decimal from "decimal.js";

function drillDownHref(row: PnlArticleRow, from: string, to: string) {
  const params = new URLSearchParams({ from, to });
  if (row.articleId) params.set("pnlArticleId", row.articleId);
  return `/accruals?${params.toString()}`;
}

export default async function PnlReportPage({
  searchParams,
}: {
  searchParams: Promise<ReportSearchParams & { compare?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.REPORTS_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра отчёта.</div>
      </div>
    );
  }

  const sp = await searchParams;
  const period = resolveReportPeriod(sp);
  const prior = previousPeriod(period);
  const filters = extractFilters(sp);
  const scope = await getAccessScope(session);
  const [report, priorReport] = await Promise.all([
    computePnlReport(period, filters, scope),
    computePnlReport(prior, filters, scope),
  ]);

  const compareRequested = sp.compare === "plan" ? "plan" : "prior";
  const availability = resolvePlanAvailability(filters, scope);
  const planItems =
    compareRequested === "plan" && availability.available
      ? await loadPlanItems("PNL", period.year, period.month, availability.organizationIds)
      : [];
  const showPlan = planItems.length > 0;
  const budgetHref = `/budget?kind=pnl&year=${period.year}${filters.organizationId ? `&org=${filters.organizationId}` : ""}`;

  const planByType = Object.fromEntries(PNL_TYPE_ORDER.map((type) => [type, planTotal(planItems, type)])) as Record<
    PnlType,
    Decimal | null
  >;
  const planTotals = derivePnlTotals({
    revenue: planByType.REVENUE ?? toDecimal(0),
    directVariable: planByType.DIRECT_VARIABLE ?? toDecimal(0),
    directFixed: planByType.DIRECT_FIXED ?? toDecimal(0),
    indirect: planByType.INDIRECT ?? toDecimal(0),
    otherIncome: planByType.OTHER_INCOME ?? toDecimal(0),
    otherExpense: planByType.OTHER_EXPENSE ?? toDecimal(0),
    tax: planByType.TAX ?? toDecimal(0),
  });
  const rowsByType = Object.fromEntries(
    PNL_TYPE_ORDER.map((type) => [
      type,
      mergePlanIntoRows(
        report.byType[type].rows,
        planItems.filter((p) => p.group === type),
        (item): PnlArticleRow => ({ articleId: item.articleId, articleName: item.articleName, amount: toDecimal(0), documentIds: [] }),
      ),
    ]),
  ) as Record<PnlType, Array<PnlArticleRow & PlanFactMetrics>>;
  const natureOf = (type: PnlType) => (PNL_INCOME_TYPES.has(type) ? "income" : "expense");
  const planNote = (value: Decimal) => (showPlan ? <div className="text-muted">план {formatMoney(value)}</div> : null);

  const fromStr = period.from.toISOString().slice(0, 10);
  const toStr = period.to.toISOString().slice(0, 10);
  const exportHref = `/api/reports/export?type=pnl&year=${period.year}&month=${period.month}${
    filters.organizationId ? `&organizationId=${filters.organizationId}` : ""
  }${filters.departmentId ? `&departmentId=${filters.departmentId}` : ""}${
    filters.costCenterId ? `&costCenterId=${filters.costCenterId}` : ""
  }${filters.projectId ? `&projectId=${filters.projectId}` : ""}${
    filters.productServiceId ? `&productServiceId=${filters.productServiceId}` : ""
  }${filters.counterpartyId ? `&counterpartyId=${filters.counterpartyId}` : ""}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>ОПиУ — Отчёт о прибылях и убытках</h1>
          <p>Период: {period.label}, метод начисления. Считается только из проведённых документов.</p>
        </div>
        <a href={exportHref} className="btn btn-secondary">
          Экспорт в Excel
        </a>
      </div>

      <ReportFilterBar values={{ year: period.year, month: period.month, ...filters }}>
        <label className="field">
          <span>Сравнить с</span>
          <select name="compare" defaultValue={compareRequested}>
            <option value="prior">Предыдущим месяцем</option>
            <option value="plan">Планом (бюджетом)</option>
          </select>
        </label>
      </ReportFilterBar>

      {compareRequested === "plan" ? (
        <div className="card" style={{ marginBottom: 16 }}>
          {!availability.available ? (
            <p className="text-muted">{availability.reason} Показано сравнение с предыдущим месяцем.</p>
          ) : showPlan ? (
            <p className="text-muted">
              План из раздела <Link href={budgetHref}>«Бюджет»</Link>
              {filters.organizationId ? " по выбранной организации" : " (компания в целом и все организации)"}.
              Отклонение = факт − план; зелёным — в пользу компании (больше доходов, меньше расходов), красным — нет.
            </p>
          ) : (
            <p className="text-muted">
              План на {period.label} не задан — заполните его в разделе <Link href={budgetHref}>«Бюджет»</Link>. Пока
              показано сравнение с предыдущим месяцем.
            </p>
          )}
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Выручка</div>
          <div className="stat-value">{formatMoney(report.revenue)}</div>
          {planNote(planTotals.revenue)}
        </div>
        <div className="stat-card">
          <div className="stat-label">Валовая прибыль</div>
          <div className="stat-value">{formatMoney(report.grossProfit)}</div>
          {planNote(planTotals.grossProfit)}
        </div>
        <div className="stat-card">
          <div className="stat-label">Операционная прибыль</div>
          <div className="stat-value">{formatMoney(report.operatingProfit)}</div>
          {planNote(planTotals.operatingProfit)}
        </div>
        <div className="stat-card">
          <div className="stat-label">Чистая прибыль</div>
          <div className="stat-value">{formatMoney(report.netProfit)}</div>
          {planNote(planTotals.netProfit)}
        </div>
        <div className="stat-card">
          <div className="stat-label">Валовая рентабельность</div>
          <div className="stat-value">{report.grossMarginPct ? `${formatNumber(report.grossMarginPct)}%` : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Чистая рентабельность</div>
          <div className="stat-value">{report.netMarginPct ? `${formatNumber(report.netMarginPct)}%` : "—"}</div>
        </div>
      </div>

      <div className="card">
        {showPlan ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Статья</th>
                  <th>Документов</th>
                  <th>Факт</th>
                  {PLAN_FACT_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PNL_TYPE_ORDER.map((type) => {
                  const bucket = report.byType[type];
                  const rows = rowsByType[type];
                  if (rows.length === 0 && !planByType[type]) return null;
                  return (
                    <Fragment key={type}>
                      <tr style={{ background: "var(--color-graphite-50)" }}>
                        <td style={{ fontWeight: 700 }}>{TYPE_LABELS[type]}</td>
                        <td />
                        <td className="mono" style={{ fontWeight: 700 }}>
                          {formatMoney(bucket.total)}
                        </td>
                        <PlanFactCells metrics={planFactMetrics(bucket.total, planByType[type])} nature={natureOf(type)} bold />
                      </tr>
                      {rows.map((row) => (
                        <tr key={row.articleId ?? `${type}-none`}>
                          <td style={{ paddingLeft: 24 }}>
                            <Link href={drillDownHref(row, fromStr, toStr)}>{row.articleName}</Link>
                          </td>
                          <td>{row.documentIds.length}</td>
                          <td className="mono">{formatMoney(row.amount)}</td>
                          <PlanFactCells metrics={row} nature={natureOf(type)} />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
                {(
                  [
                    ["Валовая прибыль", report.grossProfit, planTotals.grossProfit],
                    ["Операционная прибыль", report.operatingProfit, planTotals.operatingProfit],
                    ["Чистая прибыль", report.netProfit, planTotals.netProfit],
                  ] as const
                ).map(([label, fact, plan]) => (
                  <tr key={label} style={{ borderTop: "2px solid var(--color-graphite-150)" }}>
                    <td style={{ fontWeight: 700 }}>{label}</td>
                    <td />
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {formatMoney(fact)}
                    </td>
                    <PlanFactCells metrics={planFactMetrics(fact, plan)} nature="income" bold />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Статья</th>
                  <th>Документов</th>
                  <th>Текущий период</th>
                  <th>Предыдущий период ({prior.label})</th>
                  <th>Изменение</th>
                </tr>
              </thead>
              <tbody>
                {PNL_TYPE_ORDER.map((type) => {
                  const bucket = report.byType[type];
                  const priorTotal = priorReport.byType[type].total;
                  const delta = bucket.total.minus(priorTotal);
                  return (
                    <Fragment key={type}>
                      <tr style={{ background: "var(--color-graphite-50)" }}>
                        <td style={{ fontWeight: 700 }}>{TYPE_LABELS[type]}</td>
                        <td />
                        <td className="mono" style={{ fontWeight: 700 }}>
                          {formatMoney(bucket.total)}
                        </td>
                        <td className="mono text-muted">{formatMoney(priorTotal)}</td>
                        <td className="mono">{formatMoney(delta)}</td>
                      </tr>
                      {bucket.rows.map((row) => (
                        <tr key={row.articleId ?? `${type}-none`}>
                          <td style={{ paddingLeft: 24 }}>
                            <Link href={drillDownHref(row, fromStr, toStr)}>{row.articleName}</Link>
                          </td>
                          <td>{row.documentIds.length}</td>
                          <td className="mono">{formatMoney(row.amount)}</td>
                          <td />
                          <td />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p className="text-muted">
          Маржинальность по проектам/продуктам/клиентам и точка безубыточности — на странице «Маржинальность».
        </p>
      </div>
    </div>
  );
}
