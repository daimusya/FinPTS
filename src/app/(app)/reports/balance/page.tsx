import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import { computeManagementBalance } from "@/lib/reports/balance";
import { prisma } from "@/lib/db";

export default async function BalanceReportPage({
  searchParams,
}: {
  searchParams: Promise<ReportSearchParams & { asOf?: string }>;
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
  const asOfDate = sp.asOf ? new Date(sp.asOf) : new Date();
  const [balance, organizations] = await Promise.all([
    computeManagementBalance(asOfDate, filters),
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Управленческий баланс</h1>
          <p>На дату: {balance.asOfDate.toLocaleDateString("ru-RU")}</p>
        </div>
      </div>

      <form className="filter-bar">
        <label className="field">
          <span>На дату</span>
          <input type="date" name="asOf" defaultValue={asOfDate.toISOString().slice(0, 10)} />
        </label>
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
        <button type="submit" className="btn btn-secondary">
          Применить
        </button>
      </form>

      <div
        className="card"
        style={{
          marginBottom: 16,
          borderColor: balance.isBalanced ? "var(--color-success)" : "var(--color-danger)",
        }}
      >
        {balance.isBalanced ? (
          <p className="form-success">
            Контрольное равенство выполняется: Активы − Обязательства = Капитал + Прибыль.
          </p>
        ) : (
          <>
            <p className="form-error">
              Расхождение контрольного равенства: {formatMoney(balance.discrepancy)}.
            </p>
            <p className="text-muted" style={{ marginTop: 6 }}>
              Актив минус обязательства ({formatMoney(balance.equityImpliedByBalance)}) не совпадает с
              накопленной чистой прибылью по ОПиУ ({formatMoney(balance.totalEquity)}). Возможные причины:
              капитал, займы, авансы, основные средства и остатки на начало учёта в системе пока не
              выделяются отдельно (раздел «Не реализовано» README) — их значение сейчас принято равным нулю,
              хотя в реальности оно может быть ненулевым.
            </p>
          </>
        )}
      </div>

      <div className="stat-grid">
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Активы</h2>
          <BalanceLine label="Денежные средства" value={balance.cash} />
          <BalanceLine label="Дебиторская задолженность" value={balance.receivable} />
          <BalanceLine label="Авансы выданные" value={balance.advancesIssued} note="не выделяются, всегда 0" />
          <BalanceLine label="Прочие активы" value={balance.otherAssets} note="не выделяются, всегда 0" />
          <BalanceLine label="Итого активы" value={balance.totalAssets} bold />
        </div>
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Обязательства и капитал</h2>
          <BalanceLine label="Кредиторская задолженность" value={balance.payable} />
          <BalanceLine label="Авансы полученные" value={balance.advancesReceived} note="не выделяются, всегда 0" />
          <BalanceLine label="Налоги и зарплата к выплате" value={balance.taxesPayrollPayable} note="не выделяются, всегда 0" />
          <BalanceLine label="Займы и кредиты" value={balance.loans} note="не выделяются, всегда 0" />
          <BalanceLine label="Итого обязательства" value={balance.totalLiabilities} bold />
          <BalanceLine label="Капитал" value={balance.capital} note="не выделяется, всегда 0" />
          <BalanceLine label="Нераспределённая прибыль (по ОПиУ)" value={balance.retainedEarnings} />
          <BalanceLine label="Итого капитал" value={balance.totalEquity} bold />
        </div>
      </div>
    </div>
  );
}

function BalanceLine({
  label,
  value,
  bold,
  note,
}: {
  label: string;
  value: import("decimal.js").default;
  bold?: boolean;
  note?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 0",
        borderTop: bold ? "1px solid var(--color-graphite-150)" : undefined,
        fontWeight: bold ? 700 : 400,
      }}
    >
      <span>
        {label}
        {note ? <span className="text-muted"> ({note})</span> : null}
      </span>
      <span className="mono">{formatMoney(value)}</span>
    </div>
  );
}
