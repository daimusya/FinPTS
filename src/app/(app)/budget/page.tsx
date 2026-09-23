import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, sumMoney, toDecimal } from "@/lib/money";
import { getAccessScope, organizationScopeWhere } from "@/lib/access-scope";
import { MONTH_NAMES_SHORT } from "@/lib/financial-model/drivers";
import { PNL_TYPE_LABELS, PNL_TYPE_ORDER } from "@/lib/reports/pnl";
import { saveBudgetAction, type BudgetKindSlug } from "./actions";
import type Decimal from "decimal.js";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
// Digits with optional thousands spaces and up to two decimals after a dot or comma; checked again on the server.
const AMOUNT_PATTERN = "[0-9\\s\\u00a0]*([.,][0-9]{1,2})?";

interface ArticleGroup {
  title: string;
  articles: Array<{ id: string; name: string; isArchived: boolean }>;
}

export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; year?: string; org?: string; saved?: string; error?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_MANAGE);
  const scope = await getAccessScope(session);

  const sp = await searchParams;
  const kindSlug: BudgetKindSlug = sp.kind === "cash-flow" ? "cash-flow" : "pnl";
  const kind = kindSlug === "cash-flow" ? "CASH_FLOW" : "PNL";
  const year = Number(sp.year) || new Date().getFullYear();

  const organizations = await prisma.organization.findMany({
    where: { isArchived: false, ...organizationScopeWhere(scope) },
    orderBy: { name: "asc" },
  });
  // A user limited to some organizations can't see or edit the company-wide plan.
  const companyWideAllowed = scope.organizationIds === null;
  const requestedOrg = sp.org && organizations.some((o) => o.id === sp.org) ? sp.org : null;
  const organizationId = requestedOrg ?? (companyWideAllowed ? null : (organizations[0]?.id ?? null));

  if (!companyWideAllowed && !organizationId) {
    return (
      <div className="page">
        <div className="card">Нет доступных организаций для планирования.</div>
      </div>
    );
  }

  const entries = await prisma.budgetEntry.findMany({ where: { kind, year, organizationId } });
  const values = new Map<string, Decimal>();
  for (const e of entries) {
    const articleId = e.cashFlowArticleId ?? e.pnlArticleId;
    if (articleId) values.set(`${articleId}-${e.month}`, toDecimal(e.amount));
  }
  const planned = new Set(entries.map((e) => e.cashFlowArticleId ?? e.pnlArticleId));

  let groups: ArticleGroup[];
  if (kind === "CASH_FLOW") {
    const articles = await prisma.cashFlowArticle.findMany({
      where: { direction: { not: "TRANSFER" } },
      orderBy: { name: "asc" },
    });
    const visible = articles.filter((a) => !a.isArchived || planned.has(a.id));
    groups = [
      { title: "Поступления", articles: visible.filter((a) => a.direction === "INFLOW") },
      { title: "Выплаты", articles: visible.filter((a) => a.direction === "OUTFLOW") },
    ];
  } else {
    const articles = await prisma.pnlArticle.findMany({ orderBy: { name: "asc" } });
    const visible = articles.filter((a) => !a.isArchived || planned.has(a.id));
    groups = PNL_TYPE_ORDER.map((type) => ({
      title: PNL_TYPE_LABELS[type],
      articles: visible.filter((a) => a.type === type),
    }));
  }
  groups = groups.filter((g) => g.articles.length > 0);

  const cell = (articleId: string, month: number) => values.get(`${articleId}-${month}`);
  const rowTotal = (articleId: string) => sumMoney(MONTHS.map((m) => cell(articleId, m) ?? 0));
  const groupMonthTotal = (group: ArticleGroup, month: number) => sumMoney(group.articles.map((a) => cell(a.id, month) ?? 0));

  const orgLabel = organizationId
    ? (organizations.find((o) => o.id === organizationId)?.shortName ?? organizations.find((o) => o.id === organizationId)?.name)
    : "компания в целом";
  const reportHref = kind === "CASH_FLOW" ? "/reports/cash-flow" : "/reports/pnl?compare=plan";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Бюджет {kind === "CASH_FLOW" ? "движения денежных средств (БДДС)" : "доходов и расходов (БДР)"}</h1>
          <p>
            План на {year} год по статьям {kind === "CASH_FLOW" ? "ДДС" : "ОПиУ"}, {orgLabel}. Суммы вводятся
            положительными — поступление это или выплата, доход или расход, определяет статья. Пустая ячейка — плана
            нет, 0 — запланирован ноль. Сравнение с фактом — в отчёте{" "}
            <Link href={reportHref}>{kind === "CASH_FLOW" ? "ДДС" : "ОПиУ"}</Link>.
          </p>
        </div>
      </div>

      <form className="filter-bar">
        <label className="field">
          <span>Бюджет</span>
          <select name="kind" defaultValue={kindSlug}>
            <option value="pnl">Доходов и расходов (ОПиУ)</option>
            <option value="cash-flow">Движения денег (ДДС)</option>
          </select>
        </label>
        <label className="field">
          <span>Год</span>
          <input type="number" name="year" defaultValue={year} style={{ width: 90 }} />
        </label>
        <label className="field">
          <span>Организация</span>
          <select name="org" defaultValue={organizationId ?? ""}>
            {companyWideAllowed ? <option value="">Компания в целом (без разбивки)</option> : null}
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.shortName || o.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">
          Показать
        </button>
      </form>

      {sp.saved ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">План сохранён.</p>
        </div>
      ) : null}
      {sp.error ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error">Ничего не сохранено: {sp.error}</p>
        </div>
      ) : null}

      <div className="card">
        {groups.length === 0 ? (
          <p className="empty-state">
            Нет статей {kind === "CASH_FLOW" ? "ДДС" : "ОПиУ"} — сначала заведите их в справочнике.
          </p>
        ) : (
          <form action={saveBudgetAction.bind(null, kindSlug, year, organizationId)}>
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ position: "sticky", left: 0, background: "var(--color-graphite-50)" }}>Статья</th>
                    {MONTHS.map((m) => (
                      <th key={m}>{MONTH_NAMES_SHORT[m - 1]}</th>
                    ))}
                    <th>Итого за год</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <Fragment key={group.title}>
                      <tr style={{ background: "var(--color-graphite-50)" }}>
                        <td style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{group.title}</td>
                        {MONTHS.map((m) => (
                          <td key={m} className="mono text-muted">
                            {formatMoney(groupMonthTotal(group, m))}
                          </td>
                        ))}
                        <td className="mono" style={{ fontWeight: 700 }}>
                          {formatMoney(sumMoney(group.articles.map((a) => rowTotal(a.id))))}
                        </td>
                      </tr>
                      {group.articles.map((article) => (
                        <tr key={article.id}>
                          <td style={{ paddingLeft: 24, whiteSpace: "nowrap" }}>
                            {article.name}
                            {article.isArchived ? <span className="text-muted"> (в архиве)</span> : null}
                          </td>
                          {MONTHS.map((m) => (
                            <td key={m}>
                              <input
                                type="text"
                                inputMode="decimal"
                                pattern={AMOUNT_PATTERN}
                                title="Сумма, например 150 000 или 1500,50"
                                aria-label={`${article.name}, ${MONTH_NAMES_SHORT[m - 1]}`}
                                style={{ width: 96 }}
                                name={`b__${article.id}__${m}`}
                                defaultValue={cell(article.id, m)?.toFixed(2) ?? ""}
                                disabled={!canManage}
                              />
                            </td>
                          ))}
                          <td className="mono">{formatMoney(rowTotal(article.id))}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            {canManage ? (
              <button type="submit" className="btn btn-primary">
                Сохранить план на {year} год
              </button>
            ) : null}
          </form>
        )}
        <p className="text-muted" style={{ marginTop: 12 }}>
          В отчёте без фильтра по организации план складывается из плана компании в целом и планов всех организаций.
          Поэтому задавайте план одним способом — либо по компании в целом, либо по каждой организации, — иначе он
          учтётся дважды.
        </p>
      </div>
    </div>
  );
}
