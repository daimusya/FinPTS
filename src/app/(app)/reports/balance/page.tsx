import Link from "next/link";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { extractFilters, type ReportSearchParams } from "@/lib/reports/filters";
import { computeManagementBalance } from "@/lib/reports/balance";
import { acceptsManualEntries, type BalanceArticleLine } from "@/lib/reports/balance-lines";
import { prisma } from "@/lib/db";
import { getAccessScope, organizationScopeWhere } from "@/lib/access-scope";
import { addBalanceEntryAction, deleteBalanceEntryAction } from "./actions";
import type Decimal from "decimal.js";

const CATEGORY_LABELS: Record<string, string> = { ASSET: "актив", LIABILITY: "обязательство", EQUITY: "капитал" };

export default async function BalanceReportPage({
  searchParams,
}: {
  searchParams: Promise<ReportSearchParams & { asOf?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.REPORTS_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра отчёта.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.ACCRUALS_MANAGE);

  const sp = await searchParams;
  const filters = extractFilters(sp);
  const asOfDate = sp.asOf ? new Date(sp.asOf) : new Date();
  const scope = await getAccessScope(session);
  const entryWhere = filters.organizationId
    ? { organizationId: filters.organizationId }
    : scope.organizationIds
      ? { organizationId: { in: scope.organizationIds } }
      : {};
  const [balance, organizations, entries, articles, linkedCashFlowArticles] = await Promise.all([
    computeManagementBalance(asOfDate, filters, scope),
    prisma.organization.findMany({ where: { isArchived: false, ...organizationScopeWhere(scope) }, orderBy: { name: "asc" } }),
    prisma.balanceEntry.findMany({
      where: entryWhere,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { balanceArticle: true, organization: true },
    }),
    prisma.balanceArticle.findMany({ where: { isArchived: false }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    prisma.cashFlowArticle.findMany({
      where: { balanceArticleId: { not: null } },
      include: { balanceArticle: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const manualArticles = articles.filter((a) => acceptsManualEntries(a.systemCode));

  const asOfStr = asOfDate.toISOString().slice(0, 10);
  const exportHref = `/api/reports/export?type=balance&asOf=${asOfStr}${
    filters.organizationId ? `&organizationId=${filters.organizationId}` : ""
  }`;
  const keepFilters = (
    <>
      <input type="hidden" name="back_asOf" value={sp.asOf ?? ""} />
      <input type="hidden" name="back_organizationId" value={filters.organizationId ?? ""} />
    </>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Управленческий баланс</h1>
          <p>На дату: {balance.asOfDate.toLocaleDateString("ru-RU")}</p>
        </div>
        <a href={exportHref} className="btn btn-secondary">
          Экспорт в Excel
        </a>
      </div>

      <form className="filter-bar">
        <label className="field">
          <span>На дату</span>
          <input type="date" name="asOf" defaultValue={asOfStr} />
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

      {sp.error ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error">{sp.error}</p>
        </div>
      ) : null}

      <div
        className="card"
        style={{
          marginBottom: 16,
          borderColor: balance.isBalanced ? "var(--color-success)" : "var(--color-danger)",
        }}
      >
        {balance.isBalanced ? (
          <p className="form-success">Контрольное равенство выполняется: Активы − Обязательства = Капитал.</p>
        ) : (
          <>
            <p className="form-error">Расхождение контрольного равенства: {formatMoney(balance.discrepancy)}.</p>
            <p className="text-muted" style={{ marginTop: 6 }}>
              Активы минус обязательства ({formatMoney(balance.equityImpliedByBalance)}) не совпадают с капиталом (
              {formatMoney(balance.totalEquity)}). Значит, часть денег или задолженности прошла мимо и документов
              начисления, и статей баланса. Частые причины: расход или поступление без документа и без контрагента
              (комиссии банка, налоги без начисления); займ, взнос или покупка оборудования по статье ДДС, не
              привязанной к статье баланса; не введены остатки на начало учёта (деньги на счетах, капитал,
              нераспределённая прибыль прошлых лет) — их можно ввести балансовыми операциями ниже.
              {filters.organizationId
                ? " Операции без организации в отчёте по одной организации не учитываются."
                : ""}
            </p>
          </>
        )}
      </div>

      <div className="stat-grid">
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Активы</h2>
          <BalanceLine label="Денежные средства" value={balance.cash} />
          <BalanceLine label="Дебиторская задолженность" value={balance.receivable} />
          <BalanceLine label="Авансы выданные" value={balance.advancesIssued} note="платежи контрагентам без документа" />
          {balance.assetArticles.map((a) => (
            <ArticleLine key={a.id} line={a} />
          ))}
          <BalanceLine label="Итого активы" value={balance.totalAssets} bold />
        </div>
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Обязательства и капитал</h2>
          <BalanceLine label="Кредиторская задолженность" value={balance.payable} />
          <BalanceLine label="Авансы полученные" value={balance.advancesReceived} note="поступления без документа" />
          <BalanceLine label="Налоги и зарплата к выплате" value={balance.payrollPayable} note="по расчётам зарплаты" />
          {balance.liabilityArticles.map((a) => (
            <ArticleLine key={a.id} line={a} />
          ))}
          <BalanceLine label="Итого обязательства" value={balance.totalLiabilities} bold />
          {balance.equityArticles.map((a) => (
            <ArticleLine key={a.id} line={a} />
          ))}
          <BalanceLine
            label="Нераспределённая прибыль"
            value={balance.retainedEarnings}
            note={
              balance.retainedAdjustments.isZero()
                ? "по ОПиУ"
                : `по ОПиУ ${formatMoney(balance.retainedFromPnl)} + операции ${formatMoney(balance.retainedAdjustments)}`
            }
          />
          <BalanceLine label="Итого капитал" value={balance.totalEquity} bold />
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Балансовые операции</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Ручные изменения остатков статей баланса: остатки на начало учёта, корректировки. Сумма со знаком: «+»
          увеличивает остаток статьи, «−» уменьшает. Деньги, дебиторка, кредиторка и авансы считаются из операций —
          по ним операции не вводятся. Займы, взносы в капитал и покупку оборудования удобнее вести через статьи ДДС,
          привязанные к статье баланса (справочник «Статьи ДДС», поле «Статья баланса»)
          {linkedCashFlowArticles.length > 0
            ? `; сейчас привязаны: ${linkedCashFlowArticles.map((c) => `«${c.name}» → «${c.balanceArticle!.name}»`).join(", ")}`
            : ""}
          .
        </p>
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Статья баланса</th>
                <th>Организация</th>
                <th>Сумма</th>
                <th>Комментарий</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.date.toLocaleDateString("ru-RU")}</td>
                  <td>{e.balanceArticle.name}</td>
                  <td>{e.organization ? e.organization.shortName || e.organization.name : "вся компания"}</td>
                  <td className="mono">{formatMoney(e.amount)}</td>
                  <td>{e.comment ?? ""}</td>
                  <td>
                    {canManage ? (
                      <form action={deleteBalanceEntryAction.bind(null, e.id)}>
                        {keepFilters}
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Удалить
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Балансовых операций нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <form action={addBalanceEntryAction} className="form-grid" style={{ alignItems: "flex-end" }}>
            {keepFilters}
            <label className="field">
              <span>Дата</span>
              <input type="date" name="date" required defaultValue={asOfStr} />
            </label>
            <label className="field">
              <span>Статья баланса</span>
              <select name="balanceArticleId" required defaultValue="">
                <option value="">— выбрать —</option>
                {manualArticles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({CATEGORY_LABELS[a.category]})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Организация</span>
              <select name="organizationId" defaultValue={filters.organizationId ?? ""}>
                {scope.organizationIds === null ? <option value="">Вся компания</option> : null}
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName || o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Сумма, ₽ («−» — уменьшение)</span>
              <input type="text" inputMode="decimal" name="amount" required pattern="-?[0-9\s ]+([.,][0-9]{1,2})?" style={{ width: 140 }} />
            </label>
            <label className="field">
              <span>Комментарий</span>
              <input type="text" name="comment" placeholder="например, остаток на начало учёта" />
            </label>
            <button type="submit" className="btn btn-secondary">
              Добавить операцию
            </button>
          </form>
        ) : null}
        <p className="text-muted" style={{ marginTop: 12 }}>
          Свои статьи баланса (например, «Основные средства», «Кредит банка») добавляются в справочнике{" "}
          <Link href="/master-data/balance-articles">«Статьи баланса»</Link>.
        </p>
      </div>
    </div>
  );
}

function ArticleLine({ line }: { line: BalanceArticleLine }) {
  const parts = [
    !line.linkedFlows.isZero() ? `по ДДС ${formatMoney(line.linkedFlows)}` : null,
    !line.entries.isZero() ? `операции ${formatMoney(line.entries)}` : null,
  ].filter(Boolean);
  return <BalanceLine label={line.name} value={line.amount} note={parts.length === 2 ? parts.join(" + ") : undefined} />;
}

function BalanceLine({ label, value, bold, note }: { label: string; value: Decimal; bold?: boolean; note?: string }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 0",
        borderTop: bold ? "1px solid var(--color-graphite-150)" : undefined,
        fontWeight: bold ? 700 : 400,
      }}
    >
      <span>
        {label}
        {note ? <span className="text-muted" style={{ fontWeight: 400 }}> ({note})</span> : null}
      </span>
      <span className="mono">{formatMoney(value)}</span>
    </div>
  );
}
