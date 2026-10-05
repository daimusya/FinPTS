import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";
import { bankTransactionScopeWhere, getAccessScope } from "@/lib/access-scope";
import { deleteBankTransactionsAction } from "../actions";
import { formatMoneyIn, transactionCurrency } from "@/lib/currency";
import { OperationsWithoutCounterparty } from "@/components/registry-by-inn";
import { SelectAllCheckbox } from "@/components/select-all-checkbox";
import { pageWindow } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { textSearchWhere } from "@/lib/text-search";
import { parseDateParam } from "@/lib/date-param";
import { singleParams } from "@/lib/query-params";
import { enumParam } from "@/lib/query-params";
import { BankTransactionDirection, BankTransactionMatchStatus } from "@prisma/client";

const BULK_FORM = "bulk-delete";

const MATCH_STATUS_LABELS: Record<string, string> = {
  UNMATCHED: "Не сопоставлено",
  PARTIALLY_MATCHED: "Частично сопоставлено",
  MATCHED: "Сопоставлено",
};

const MATCH_STATUS_BADGE: Record<string, string> = {
  UNMATCHED: "badge-danger",
  PARTIALLY_MATCHED: "badge-warning",
  MATCHED: "badge-active",
};

const PAGE_SIZE = 300;

export default async function CashTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    matchStatus?: string;
    direction?: string;
    cashFlowArticleId?: string;
    from?: string;
    to?: string;
    batchId?: string;
    notice?: string;
    error?: string;
    page?: string;
    q?: string;
  }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра банка и кассы.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const sp = singleParams(await searchParams);
  const { matchStatus, direction, cashFlowArticleId, from, to, batchId, notice, error, q } = sp;

  const scope = await getAccessScope(session);
  const scopeWhere = bankTransactionScopeWhere(scope);

  const where: Prisma.BankTransactionWhereInput = { ...scopeWhere };
  // Values outside the lists (an edited link) are ignored rather than failing the query.
  const matchStatusValue = enumParam(matchStatus, BankTransactionMatchStatus);
  const directionValue = enumParam(direction, BankTransactionDirection);
  if (matchStatusValue) where.matchStatus = matchStatusValue;
  if (directionValue) where.direction = directionValue;
  if (cashFlowArticleId) where.cashFlowArticleId = cashFlowArticleId;
  if (q?.trim()) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), textSearchWhere(["purpose", "counterpartyInn", "counterparty.fullName", "counterparty.shortName", "counterparty.inn"], q)];
  if (batchId) where.batchId = batchId;
  // A malformed date in the address (an old or edited link) is ignored instead of failing the page.
  const fromDate = parseDateParam(from);
  const toDate = parseDateParam(to);
  if (fromDate || toDate) {
    where.operationDate = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate ? { lte: toDate } : {}),
    };
  }

  // Pages instead of a silent cut at 300: older operations stay reachable from the list.
  const window = pageWindow(await prisma.bankTransaction.count({ where }), sp.page, PAGE_SIZE);
  const [transactions, unmatchedCount, batch] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ operationDate: "desc" }, { id: "desc" }],
      skip: window.skip,
      take: window.take,
      include: { bankAccount: true, cashAccount: true, counterparty: true, cashFlowArticle: true },
    }),
    prisma.bankTransaction.count({ where: { matchStatus: "UNMATCHED", ...scopeWhere } }),
    batchId ? prisma.bankImportBatch.findUnique({ where: { id: batchId }, include: { bankAccount: true } }) : null,
  ]);
  // Back to the same filtered list after a bulk delete.
  const query = new URLSearchParams(
    Object.entries({ q, matchStatus, direction, cashFlowArticleId, from, to, batchId, page: window.page > 1 ? String(window.page) : undefined }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const returnTo = query ? `/cash/transactions?${query}` : "/cash/transactions";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Банк и касса</h1>
          <p>
            Операции загружаются из выписок или вводятся вручную. Несопоставленных операций:{" "}
            <strong>{unmatchedCount}</strong>.
          </p>
          {batch ? (
            <p className="text-muted">
              Операции загрузки «{batch.fileName}» от {batch.createdAt.toLocaleDateString("ru-RU")} ({batch.bankAccount.bankName}{" "}
              {batch.bankAccount.accountNumber}). <Link href="/cash/transactions">Все операции</Link>
            </p>
          ) : null}
          {cashFlowArticleId || from || to ? (
            <p className="text-muted">
              Фильтр из отчёта применён.{" "}
              <Link href="/cash/transactions">Сбросить</Link>
            </p>
          ) : null}
        </div>
        {canManage ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/cash/import" className="btn btn-secondary">
              Загрузить выписку
            </Link>
            <Link href="/cash/transactions/new" className="btn btn-primary">
              Добавить операцию
            </Link>
          </div>
        ) : null}
      </div>

      {notice ? <p className="form-success" style={{ marginBottom: 14 }}>{notice}</p> : null}
      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
      {canManage && hasPermission(session, PERMISSIONS.MASTERDATA_MANAGE) ? <OperationsWithoutCounterparty returnTo={returnTo} /> : null}

      <form className="filter-bar">
        <label className="field" style={{ minWidth: 240 }}>
          <span>Поиск</span>
          <input type="search" name="q" id="transactions-search" defaultValue={q ?? ""} placeholder="назначение, контрагент, ИНН" />
        </label>
        <label className="field">
          <span>Статус сопоставления</span>
          <select name="matchStatus" defaultValue={matchStatus ?? ""}>
            <option value="">Все</option>
            <option value="UNMATCHED">Не сопоставлено</option>
            <option value="PARTIALLY_MATCHED">Частично сопоставлено</option>
            <option value="MATCHED">Сопоставлено</option>
          </select>
        </label>
        <label className="field">
          <span>Направление</span>
          <select name="direction" defaultValue={direction ?? ""}>
            <option value="">Все</option>
            <option value="INFLOW">Поступление</option>
            <option value="OUTFLOW">Списание</option>
          </select>
        </label>
        {batchId ? <input type="hidden" name="batchId" value={batchId} /> : null}
        <button type="submit" className="btn btn-secondary">
          Применить
        </button>
      </form>

      {canManage && transactions.length > 0 ? (
        <form id={BULK_FORM} action={deleteBankTransactionsAction} className="filter-bar" style={{ alignItems: "center" }}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <span className="text-muted">
            Отметьте операции в таблице (флажок в заголовке — все {transactions.length} на странице). Переводы удаляются
            целиком; операции с сопоставлениями и в закрытых периодах пропускаются.
          </span>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" name="confirm" /> Да, удалить
          </label>
          <button type="submit" className="btn btn-secondary">
            Удалить отмеченные
          </button>
        </form>
      ) : null}

      <p className="text-muted" style={{ fontSize: 12, margin: "8px 0" }}>
        {window.caption}
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {canManage ? (
                <th style={{ width: 32 }}>
                  <SelectAllCheckbox formId={BULK_FORM} name="ids" label="Отметить все операции на странице" />
                </th>
              ) : null}
              <th>Дата</th>
              <th>Счёт / касса</th>
              <th>Направление</th>
              <th>Сумма</th>
              <th>Контрагент</th>
              <th>Статья ДДС</th>
              <th>Сопоставление</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                {canManage ? (
                  <td>
                    <input type="checkbox" name="ids" value={tx.id} form={BULK_FORM} aria-label={`Отметить операцию от ${tx.operationDate.toLocaleDateString("ru-RU")}`} />
                  </td>
                ) : null}
                <td className="mono">{tx.operationDate.toLocaleDateString("ru-RU")}</td>
                <td>
                  <Link href={`/cash/transactions/${tx.id}`}>
                    {tx.bankAccount ? `${tx.bankAccount.bankName} · ${tx.bankAccount.accountNumber}` : tx.cashAccount?.name}
                  </Link>
                </td>
                <td>{tx.direction === "INFLOW" ? "Поступление" : "Списание"}</td>
                <td className="mono">{formatMoneyIn(tx.amount, transactionCurrency(tx))}</td>
                <td>{tx.counterparty ? tx.counterparty.shortName || tx.counterparty.fullName : "—"}</td>
                <td>{tx.cashFlowArticle?.name ?? "—"}</td>
                <td>
                  <span className={`badge ${MATCH_STATUS_BADGE[tx.matchStatus]}`}>
                    {MATCH_STATUS_LABELS[tx.matchStatus]}
                  </span>
                </td>
              </tr>
            ))}
            {transactions.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 8 : 7} className="empty-state">
                  Операций пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pager
        window={window}
        basePath="/cash/transactions"
        params={{ q, matchStatus, direction, cashFlowArticleId, from, to, batchId }}
      />
    </div>
  );
}
