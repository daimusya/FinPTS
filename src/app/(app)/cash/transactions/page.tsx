import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import type { Prisma } from "@prisma/client";

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

export default async function CashTransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ matchStatus?: string; direction?: string }>;
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
  const { matchStatus, direction } = await searchParams;

  const where: Prisma.BankTransactionWhereInput = {};
  if (matchStatus) where.matchStatus = matchStatus as never;
  if (direction) where.direction = direction as never;

  const [transactions, unmatchedCount] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: { operationDate: "desc" },
      take: 300,
      include: { bankAccount: true, cashAccount: true, counterparty: true, cashFlowArticle: true },
    }),
    prisma.bankTransaction.count({ where: { matchStatus: "UNMATCHED" } }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Банк и касса</h1>
          <p>
            Операции загружаются из выписок или вводятся вручную. Несопоставленных операций:{" "}
            <strong>{unmatchedCount}</strong>.
          </p>
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

      <form className="filter-bar">
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
        <button type="submit" className="btn btn-secondary">
          Применить
        </button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
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
                <td className="mono">{tx.operationDate.toLocaleDateString("ru-RU")}</td>
                <td>
                  <Link href={`/cash/transactions/${tx.id}`}>
                    {tx.bankAccount ? `${tx.bankAccount.bankName} · ${tx.bankAccount.accountNumber}` : tx.cashAccount?.name}
                  </Link>
                </td>
                <td>{tx.direction === "INFLOW" ? "Поступление" : "Списание"}</td>
                <td className="mono">{formatMoney(tx.amount)}</td>
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
                <td colSpan={7} className="empty-state">
                  Операций пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
