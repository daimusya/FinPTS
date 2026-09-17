import Link from "next/link";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { resolveReportPeriod } from "@/lib/reports/period";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import { computeCashFlowReport, type CashFlowArticleRow } from "@/lib/reports/cashflow";
import { ReportFilterBar } from "@/components/report-filter-bar";

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
  const report = await computeCashFlowReport(period, filters);

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
        </div>
        <div className="stat-card">
          <div className="stat-label">Выплаты</div>
          <div className="stat-value">{formatMoney(report.totalOutflow)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Остаток на конец периода</div>
          <div className="stat-value">{formatMoney(report.closingBalance)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Поступления по статьям</h2>
        <ArticleTable rows={report.inflowRows} from={fromStr} to={toStr} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Выплаты по статьям</h2>
        <ArticleTable rows={report.outflowRows} from={fromStr} to={toStr} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Внутренние переводы (нетто)</h2>
        <p className="mono" style={{ fontSize: 16 }}>
          {formatMoney(report.transfersNet)}
        </p>
        <p className="text-muted" style={{ marginTop: 6 }}>
          План-факт и прогноз ДДС появятся вместе с модулем финансового моделирования (Этап 6).
        </p>
      </div>
    </div>
  );
}

function ArticleTable({ rows, from, to }: { rows: CashFlowArticleRow[]; from: string; to: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Статья</th>
            <th>Операций</th>
            <th>Сумма</th>
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
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="empty-state">
                Нет операций за период.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
