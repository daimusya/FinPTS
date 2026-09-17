import Link from "next/link";
import { Fragment } from "react";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatNumber } from "@/lib/money";
import { resolveReportPeriod, previousPeriod } from "@/lib/reports/period";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import { computePnlReport, PNL_TYPE_ORDER, type PnlArticleRow, type PnlType } from "@/lib/reports/pnl";
import { ReportFilterBar } from "@/components/report-filter-bar";

const TYPE_LABELS: Record<PnlType, string> = {
  REVENUE: "Выручка",
  DIRECT_VARIABLE: "Прямые переменные расходы",
  DIRECT_FIXED: "Прямые постоянные расходы",
  INDIRECT: "Косвенные расходы",
  OTHER_INCOME: "Прочие доходы",
  OTHER_EXPENSE: "Прочие расходы",
  TAX: "Налоги",
};

function drillDownHref(row: PnlArticleRow, from: string, to: string) {
  const params = new URLSearchParams({ from, to });
  if (row.articleId) params.set("pnlArticleId", row.articleId);
  return `/accruals?${params.toString()}`;
}

export default async function PnlReportPage({
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
  const prior = previousPeriod(period);
  const filters = extractFilters(sp);
  const [report, priorReport] = await Promise.all([
    computePnlReport(period, filters),
    computePnlReport(prior, filters),
  ]);

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

      <ReportFilterBar values={{ year: period.year, month: period.month, ...filters }} />

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Выручка</div>
          <div className="stat-value">{formatMoney(report.revenue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Валовая прибыль</div>
          <div className="stat-value">{formatMoney(report.grossProfit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Операционная прибыль</div>
          <div className="stat-value">{formatMoney(report.operatingProfit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Чистая прибыль</div>
          <div className="stat-value">{formatMoney(report.netProfit)}</div>
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
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p className="text-muted">
          План-факт по ОПиУ появится вместе с модулем финансового моделирования (Этап 6). Маржинальность по
          проектам/продуктам/клиентам и точка безубыточности — на странице «Маржинальность».
        </p>
      </div>
    </div>
  );
}
