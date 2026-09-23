import Link from "next/link";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { resolveReportPeriod } from "@/lib/reports/period";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import { computeCashFlowReport, type CashFlowArticleRow } from "@/lib/reports/cashflow";
import { ReportFilterBar } from "@/components/report-filter-bar";
import { getAccessScope } from "@/lib/access-scope";
import { toDecimal } from "@/lib/money";
import { loadPlanItems } from "@/lib/budget/load";
import { mergePlanIntoRows, planFactMetrics, planTotal, resolvePlanAvailability, type PlanFactMetrics } from "@/lib/budget/plan-fact";
import { PLAN_FACT_HEADERS, PlanFactCells } from "@/components/plan-fact-cells";
import type Decimal from "decimal.js";

type PlanFactRow = CashFlowArticleRow & PlanFactMetrics;

function drillDownHref(row: CashFlowArticleRow, from: string, to: string) {
  const params = new URLSearchParams({ from, to });
  if (row.articleId) params.set("cashFlowArticleId", row.articleId);
  return `/cash/transactions?${params.toString()}`;
}

export default async function CashFlowReportPage({
  searchParams,
}: {
  searchParams: Promise<ReportSearchParams>;
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
  const filters = extractFilters(sp);
  const scope = await getAccessScope(session);
  const report = await computeCashFlowReport(period, filters, scope);

  const availability = resolvePlanAvailability(filters, scope);
  const planItems = availability.available
    ? await loadPlanItems("CASH_FLOW", period.year, period.month, availability.organizationIds)
    : [];
  const showPlan = planItems.length > 0;
  const emptyRow = (item: { articleId: string; articleName: string }): CashFlowArticleRow => ({
    articleId: item.articleId,
    articleName: item.articleName,
    amount: toDecimal(0),
    transactionIds: [],
  });
  const inflowRows = mergePlanIntoRows(report.inflowRows, planItems.filter((p) => p.group === "INFLOW"), emptyRow);
  const outflowRows = mergePlanIntoRows(report.outflowRows, planItems.filter((p) => p.group === "OUTFLOW"), emptyRow);
  const planInflow = planTotal(planItems, "INFLOW");
  const planOutflow = planTotal(planItems, "OUTFLOW");
  const budgetHref = `/budget?kind=cash-flow&year=${period.year}${filters.organizationId ? `&org=${filters.organizationId}` : ""}`;

  const fromStr = period.from.toISOString().slice(0, 10);
  const toStr = period.to.toISOString().slice(0, 10);
  const exportHref = `/api/reports/export?type=cash-flow&year=${period.year}&month=${period.month}${
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
          <h1>ДДС — Отчёт о движении денежных средств</h1>
          <p>
            Период: {period.label}. Считается из фактических банковских и кассовых операций. Нажмите на статью,
            чтобы увидеть операции.
          </p>
        </div>
        <a href={exportHref} className="btn btn-secondary">
          Экспорт в Excel
        </a>
      </div>

      <ReportFilterBar
        values={{
          year: period.year,
          month: period.month,
          ...filters,
        }}
      />

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Остаток на начало периода</div>
          <div className="stat-value">{formatMoney(report.openingBalance)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Поступления</div>
          <div className="stat-value">{formatMoney(report.totalInflow)}</div>
          {showPlan && planInflow ? <div className="text-muted">план {formatMoney(planInflow)}</div> : null}
        </div>
        <div className="stat-card">
          <div className="stat-label">Выплаты</div>
          <div className="stat-value">{formatMoney(report.totalOutflow)}</div>
          {showPlan && planOutflow ? <div className="text-muted">план {formatMoney(planOutflow)}</div> : null}
        </div>
        <div className="stat-card">
          <div className="stat-label">Остаток на конец периода</div>
          <div className="stat-value">{formatMoney(report.closingBalance)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        {!availability.available ? (
          <p className="text-muted">{availability.reason}</p>
        ) : showPlan ? (
          <p className="text-muted">
            План-факт: план из раздела <Link href={budgetHref}>«Бюджет»</Link>
            {filters.organizationId ? " по выбранной организации" : " (компания в целом и все организации)"}.
            Отклонение = факт − план; зелёным — в пользу компании (больше поступлений, меньше выплат), красным — нет.
          </p>
        ) : (
          <p className="text-muted">
            План на {period.label} не задан — сравнение с планом появится, когда он будет заполнен в разделе{" "}
            <Link href={budgetHref}>«Бюджет»</Link>.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Поступления по статьям</h2>
        <ArticleTable
          rows={inflowRows}
          from={fromStr}
          to={toStr}
          showPlan={showPlan}
          nature="income"
          total={report.totalInflow}
          planTotal={planInflow}
        />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Выплаты по статьям</h2>
        <ArticleTable
          rows={outflowRows}
          from={fromStr}
          to={toStr}
          showPlan={showPlan}
          nature="expense"
          total={report.totalOutflow}
          planTotal={planOutflow}
        />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Внутренние переводы (нетто)</h2>
        <p className="mono" style={{ fontSize: 16 }}>
          {formatMoney(report.transfersNet)}
        </p>
      </div>
    </div>
  );
}

function ArticleTable({
  rows,
  from,
  to,
  showPlan,
  nature,
  total,
  planTotal,
}: {
  rows: PlanFactRow[];
  from: string;
  to: string;
  showPlan: boolean;
  nature: "income" | "expense";
  total: Decimal;
  planTotal: Decimal | null;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Статья</th>
            <th>Операций</th>
            <th>{showPlan ? "Факт" : "Сумма"}</th>
            {showPlan ? PLAN_FACT_HEADERS.map((h) => <th key={h}>{h}</th>) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.articleId ?? "none"}>
              <td>
                <Link href={drillDownHref(row, from, to)}>{row.articleName}</Link>
              </td>
              <td>{row.transactionIds.length}</td>
              <td className="mono">{formatMoney(row.amount)}</td>
              {showPlan ? <PlanFactCells metrics={row} nature={nature} /> : null}
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showPlan ? 6 : 3} className="empty-state">
                Нет операций за период.
              </td>
            </tr>
          ) : null}
          {showPlan && rows.length > 0 ? (
            <tr style={{ background: "var(--color-graphite-50)" }}>
              <td style={{ fontWeight: 700 }}>Итого</td>
              <td />
              <td className="mono" style={{ fontWeight: 700 }}>
                {formatMoney(total)}
              </td>
              <PlanFactCells metrics={planFactMetrics(total, planTotal)} nature={nature} bold />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
