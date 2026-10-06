import Link from "next/link";
import { Fragment } from "react";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, sumMoney, toDecimal } from "@/lib/money";
import { departmentScopeWhere, getAccessScope, organizationScopeWhere, projectScopeWhere } from "@/lib/access-scope";
import { MONTH_NAMES_SHORT } from "@/lib/financial-model/drivers";
import { loadBudgetArticles } from "@/lib/budget/articles";
import { budgetSliceProblem, defaultSliceDims, dimKey, parseDimKey, planLevelWarning, type BudgetSlice } from "@/lib/budget/slice";
import { copyBudgetFromPreviousYearAction, importBudgetAction, saveBudgetAction, type BudgetKindSlug } from "./actions";
import type Decimal from "decimal.js";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";

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
  searchParams: Promise<{ kind?: string; year?: string; org?: string; dim?: string; saved?: string; error?: string; notice?: string }>;
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
  const limitedByDims = Boolean(scope.departmentIds || scope.projectIds);

  const sp = singleParams(await searchParams);
  const kindSlug: BudgetKindSlug = sp.kind === "cash-flow" ? "cash-flow" : "pnl";
  const kind = kindSlug === "cash-flow" ? "CASH_FLOW" : "PNL";
  const year = Number(sp.year) || new Date().getFullYear();

  const [organizations, departments, costCenters, projects] = await Promise.all([
    prisma.organization.findMany({ where: { isArchived: false, ...organizationScopeWhere(scope) }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false, ...departmentScopeWhere(scope) }, orderBy: { name: "asc" } }),
    // Cost-centre slices mix departments and projects — closed to users limited by those.
    limitedByDims ? Promise.resolve([]) : prisma.costCenter.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false, ...projectScopeWhere(scope) }, orderBy: { name: "asc" } }),
  ]);
  // A user limited to some organizations can't see or edit the company-wide plan.
  const companyWideAllowed = scope.organizationIds === null;
  const requestedOrg = sp.org && organizations.some((o) => o.id === sp.org) ? sp.org : null;
  const organizationId = requestedOrg ?? (companyWideAllowed ? null : (organizations[0]?.id ?? null));
  // Limited to some departments/projects: without an explicit slice the page opens on the first own one.
  const dims = parseDimKey(sp.dim) ?? { departmentId: null, costCenterId: null, projectId: null };
  const slice: BudgetSlice = { organizationId, ...(limitedByDims && !sp.dim ? defaultSliceDims(scope) : dims) };
  const sliceProblem = budgetSliceProblem(scope, slice);

  if (organizationId && sliceProblem) {
    return (
      <div className="page">
        <div className="card">
          {sliceProblem}. <Link href="/budget">К своему плану</Link>
        </div>
      </div>
    );
  }

  if (!companyWideAllowed && !organizationId) {
    return (
      <div className="page">
        <div className="card">Нет доступных организаций для планирования.</div>
      </div>
    );
  }

  const [entries, articles, levelRows] = await Promise.all([
    prisma.budgetEntry.findMany({ where: { kind, year, ...slice } }),
    loadBudgetArticles(kind),
    prisma.budgetEntry.groupBy({
      by: ["organizationId", "departmentId", "costCenterId", "projectId"],
      where: { kind, year, ...(scope.organizationIds ? { organizationId: { in: scope.organizationIds } } : {}) },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  // Only slices this user may open.
  const ownLevelRows = levelRows.filter((l) => !budgetSliceProblem(scope, l));
  const values = new Map<string, Decimal>();
  for (const e of entries) {
    const articleId = e.cashFlowArticleId ?? e.pnlArticleId;
    if (articleId) values.set(`${articleId}-${e.month}`, toDecimal(e.amount));
  }
  const planned = new Set(entries.map((e) => e.cashFlowArticleId ?? e.pnlArticleId));
  const visible = articles.filter((a) => !a.isArchived || planned.has(a.id));
  const groups: ArticleGroup[] = [...new Set(visible.map((a) => a.group))].map((title) => ({
    title,
    articles: visible.filter((a) => a.group === title),
  }));

  const cell = (articleId: string, month: number) => values.get(`${articleId}-${month}`);
  const rowTotal = (articleId: string) => sumMoney(MONTHS.map((m) => cell(articleId, m) ?? 0));
  const groupMonthTotal = (group: ArticleGroup, month: number) => sumMoney(group.articles.map((a) => cell(a.id, month) ?? 0));

  const orgName = (id: string | null) =>
    id ? (organizations.find((o) => o.id === id)?.shortName || organizations.find((o) => o.id === id)?.name || "организация") : "компания в целом";
  const dimName = (s: Omit<BudgetSlice, "organizationId">) =>
    s.departmentId
      ? `подразделение «${departments.find((d) => d.id === s.departmentId)?.name ?? "?"}»`
      : s.costCenterId
        ? `ЦФО «${costCenters.find((c) => c.id === s.costCenterId)?.name ?? "?"}»`
        : s.projectId
          ? `проект «${projects.find((p) => p.id === s.projectId)?.name ?? "?"}»`
          : null;
  const sliceLabel = [orgName(organizationId), dimName(slice)].filter(Boolean).join(", ");
  const sliceHref = (s: BudgetSlice) =>
    `/budget?${new URLSearchParams({ kind: kindSlug, year: String(year), org: s.organizationId ?? "", dim: dimKey(s) }).toString()}`;
  const levels = ownLevelRows.map((l) => ({ organizationId: l.organizationId, departmentId: l.departmentId, costCenterId: l.costCenterId, projectId: l.projectId }));
  const warning = planLevelWarning(levels);
  const exportHref = `/api/budget/export?${new URLSearchParams({ kind: kindSlug, year: String(year), org: organizationId ?? "", dim: dimKey(slice) }).toString()}`;
  const reportHref = kind === "CASH_FLOW" ? "/reports/cash-flow" : "/reports/pnl?compare=plan";
  const actionArgs = [kindSlug, year, organizationId, dimKey(slice)] as const;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Бюджет {kind === "CASH_FLOW" ? "движения денежных средств (БДДС)" : "доходов и расходов (БДР)"}</h1>
          <p>
            План на {year} год по статьям {kind === "CASH_FLOW" ? "ДДС" : "ОПиУ"}: {sliceLabel}. Суммы вводятся положительными —
            поступление это или выплата, доход или расход, определяет статья. Пустая ячейка — плана нет, 0 — запланирован ноль.
            Сравнение с фактом — в отчёте <Link href={reportHref}>{kind === "CASH_FLOW" ? "ДДС" : "ОПиУ"}</Link> (за месяц,
            квартал или год).
          </p>
        </div>
        <a href={exportHref} className="btn btn-secondary">
          Выгрузить в Excel
        </a>
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
        <label className="field">
          <span>Разрез</span>
          <select name="dim" defaultValue={dimKey(slice)}>
            {limitedByDims ? null : <option value="">Без разреза — статья целиком</option>}
            {departments.length ? (
              <optgroup label="Подразделение">
                {departments.map((d) => (
                  <option key={d.id} value={`dep:${d.id}`}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {costCenters.length ? (
              <optgroup label="ЦФО">
                {costCenters.map((c) => (
                  <option key={c.id} value={`cc:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {projects.length ? (
              <optgroup label="Проект">
                {projects.map((p) => (
                  <option key={p.id} value={`prj:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
        </label>
        <SubmitButton className="btn btn-secondary">
          Показать
        </SubmitButton>
      </form>

      {sp.saved ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">План сохранён.</p>
        </div>
      ) : null}
      {sp.notice ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">{sp.notice}</p>
        </div>
      ) : null}
      {sp.error ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error">Ничего не сохранено: {sp.error}</p>
        </div>
      ) : null}

      {levels.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Где уже есть план на {year} год</h2>
          <ul className="budget-levels">
            {ownLevelRows.map((l) => {
              const s = { organizationId: l.organizationId, departmentId: l.departmentId, costCenterId: l.costCenterId, projectId: l.projectId };
              const current = dimKey(s) === dimKey(slice) && s.organizationId === organizationId;
              return (
                <li key={`${s.organizationId}-${dimKey(s)}`}>
                  {current ? (
                    <strong>{[orgName(s.organizationId), dimName(s)].filter(Boolean).join(", ")}</strong>
                  ) : (
                    <Link href={sliceHref(s)}>{[orgName(s.organizationId), dimName(s)].filter(Boolean).join(", ")}</Link>
                  )}{" "}
                  <span className="text-muted">
                    — {formatMoney(toDecimal(l._sum.amount ?? 0))} за год, ячеек: {l._count}
                  </span>
                </li>
              );
            })}
          </ul>
          {warning ? <p className="form-error" style={{ marginTop: 8 }}>{warning}</p> : null}
        </div>
      ) : null}

      <div className="card">
        {groups.length === 0 ? (
          <p className="empty-state">Нет статей {kind === "CASH_FLOW" ? "ДДС" : "ОПиУ"} — сначала заведите их в справочнике.</p>
        ) : (
          <form action={saveBudgetAction.bind(null, ...actionArgs)}>
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
              <SubmitButton className="btn btn-primary">
                Сохранить план на {year} год
              </SubmitButton>
            ) : null}
          </form>
        )}
        <p className="text-muted" style={{ marginTop: 12 }}>
          В отчёте без фильтров план складывается из всех уровней: компании в целом, организаций и разрезов. С фильтром по
          подразделению, ЦФО или проекту отчёт сравнивается с планом этого разреза. Поэтому задавайте план одним способом —
          иначе он учтётся дважды (выше будет предупреждение).
        </p>
      </div>

      {canManage ? (
        <div className="budget-tools">
          <div className="card">
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Загрузить план из Excel</h2>
            <form action={importBudgetAction.bind(null, ...actionArgs)}>
              <label className="field">
                <span>Файл (XLSX, XLS, CSV)</span>
                <input type="file" name="file" id="budget-file" accept=".xlsx,.xls,.csv" required />
              </label>
              <div className="form-actions" style={{ marginTop: 10 }}>
                <SubmitButton className="btn btn-secondary">
                  Загрузить в «{sliceLabel}»
                </SubmitButton>
              </div>
            </form>
            <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
              Формат — как у выгрузки: колонки «Статья», «Код» и месяцы (Янв … Дек или 1 … 12). Статья ищется по коду, иначе по
              названию. План статей из файла заменяется целиком (пустая ячейка — плана нет), остальные статьи не меняются. При
              любой ошибке не сохраняется ничего.
            </p>
          </div>
          <div className="card">
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Скопировать план с {year - 1} года</h2>
            <form action={copyBudgetFromPreviousYearAction.bind(null, ...actionArgs)}>
              <label className="field">
                <span>Поправка, %</span>
                <input type="text" inputMode="decimal" name="percent" id="budget-percent" placeholder="например, 10 или -5" />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
                <input type="checkbox" name="overwrite" id="budget-overwrite" />
                Заменить текущий план на {year} год, если он уже есть
              </label>
              <div className="form-actions" style={{ marginTop: 10 }}>
                <SubmitButton className="btn btn-secondary">
                  Скопировать
                </SubmitButton>
              </div>
            </form>
            <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
              Копируется план этого же среза ({sliceLabel}) за {year - 1} год по всем статьям и месяцам; +10 — на 10 % больше.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
