import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatNumber } from "@/lib/money";
import { resolveReportPeriod } from "@/lib/reports/period";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import { computeMarginReport, type DimensionMarginRow } from "@/lib/reports/margin";
import { ReportFilterBar } from "@/components/report-filter-bar";
import { getAccessScope } from "@/lib/access-scope";

export default async function MarginReportPage({
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
  const report = await computeMarginReport(period, filters, scope);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Маржинальность и точка безубыточности</h1>
          <p>
            Период: {period.label}. Точка безубыточности = Постоянные затраты / Доля маржинального дохода.
            Драйвер распределения косвенных расходов — пропорционально выручке (единственный вариант в этой
            версии; настраиваемый драйвер — Этап 6).
          </p>
        </div>
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
          <div className="stat-label">Валовая маржинальность</div>
          <div className="stat-value">{report.grossMarginPct ? `${formatNumber(report.grossMarginPct)}%` : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Операционная прибыль</div>
          <div className="stat-value">{formatMoney(report.operatingProfit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Точка безубыточности</div>
          <div className="stat-value">{report.breakEvenRevenue ? formatMoney(report.breakEvenRevenue) : "—"}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Запас финансовой прочности</div>
          <div className="stat-value">
            {report.marginOfSafetyPct ? `${formatNumber(report.marginOfSafetyPct)}%` : "—"}
          </div>
        </div>
      </div>

      <DimensionTable title="По проектам" rows={report.byProject} />
      <DimensionTable title="По продуктам и услугам" rows={report.byProductService} />
      <DimensionTable title="По клиентам" rows={report.byCounterparty} />
    </div>
  );
}

function DimensionTable({ title, rows }: { title: string; rows: DimensionMarginRow[] }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Выручка</th>
              <th>Прямые затраты</th>
              <th>Валовая прибыль</th>
              <th>Маржинальность</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td className="mono">{formatMoney(row.revenue)}</td>
                <td className="mono">{formatMoney(row.directCost)}</td>
                <td className="mono">{formatMoney(row.grossProfit)}</td>
                <td className="mono">{row.grossMarginPct ? `${formatNumber(row.grossMarginPct)}%` : "—"}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
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
