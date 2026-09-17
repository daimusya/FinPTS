import Link from "next/link";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { ACCRUAL_DOCUMENT_TYPE_LABELS } from "@/lib/accruals/labels";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import { computeDebtsReport, type DebtRow } from "@/lib/reports/debts";
import { prisma } from "@/lib/db";

export default async function DebtsReportPage({
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
  const filters = extractFilters(sp);
  const [report, organizations, counterparties] = await Promise.all([
    computeDebtsReport(filters),
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
  ]);

  const exportHref = `/api/reports/export?type=debts${
    filters.organizationId ? `&organizationId=${filters.organizationId}` : ""
  }${filters.counterpartyId ? `&counterpartyId=${filters.counterpartyId}` : ""}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Дебиторская и кредиторская задолженность</h1>
          <p>Считается из проведённых непогашенных документов начисления: сумма минус сопоставленные оплаты.</p>
        </div>
        <a href={exportHref} className="btn btn-secondary">
          Экспорт в Excel
        </a>
      </div>

      <form className="filter-bar">
        <label className="field">
          <span>Организация</span>
          <select name="organizationId" defaultValue={filters.organizationId ?? ""}>
            <option value="">Все</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.shortName || o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Контрагент</span>
          <select name="counterpartyId" defaultValue={filters.counterpartyId ?? ""}>
            <option value="">Все</option>
            {counterparties.map((c) => (
              <option key={c.id} value={c.id}>
                {c.shortName || c.fullName}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">
          Применить
        </button>
      </form>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Дебиторская задолженность</div>
          <div className="stat-value">{formatMoney(report.totalReceivable)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">в т.ч. просрочено</div>
          <div className="stat-value" style={{ color: "var(--color-danger)" }}>
            {formatMoney(report.overdueReceivable)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Кредиторская задолженность</div>
          <div className="stat-value">{formatMoney(report.totalPayable)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">в т.ч. просрочено</div>
          <div className="stat-value" style={{ color: "var(--color-danger)" }}>
            {formatMoney(report.overduePayable)}
          </div>
        </div>
      </div>

      <DebtTable title="Дебиторская задолженность (нам должны)" rows={report.receivableRows} />
      <DebtTable title="Кредиторская задолженность (мы должны)" rows={report.payableRows} />
    </div>
  );
}

function DebtTable({ title, rows }: { title: string; rows: DebtRow[] }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Контрагент</th>
              <th>Документы</th>
              <th>Сумма</th>
              <th>Просрочено</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.counterpartyId}>
                <td>{row.counterpartyName}</td>
                <td>
                  <div className="tag-list">
                    {row.documents.map((d) => (
                      <Link
                        key={d.id}
                        href={`/accruals/${d.id}`}
                        className={`badge ${d.overdue ? "badge-danger" : "badge-orange"}`}
                        title={`${ACCRUAL_DOCUMENT_TYPE_LABELS[d.documentType]} · остаток ${formatMoney(d.remaining)}`}
                      >
                        № {d.number}
                      </Link>
                    ))}
                  </div>
                </td>
                <td className="mono">{formatMoney(row.total)}</td>
                <td className="mono" style={{ color: row.overdue.greaterThan(0) ? "var(--color-danger)" : undefined }}>
                  {row.overdue.greaterThan(0) ? formatMoney(row.overdue) : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="empty-state">
                  Задолженности нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
