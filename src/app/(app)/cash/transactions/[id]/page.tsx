import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { ACCRUAL_DOCUMENT_TYPE_LABELS } from "@/lib/accruals/labels";
import { formatMoneyIn, normalizeCurrency, transactionCurrency } from "@/lib/currency";
import { allocationDocumentSide, allocationTransactionSide, documentTotal, isForeign } from "@/lib/accruals/currency";
import { isVisible } from "@/lib/access-guard";
import {
  allocatePaymentAction,
  updateTransactionClassificationAction,
  cancelAllocationAction,
  updateBankTransactionAction,
  deleteBankTransactionAction,
} from "../../actions";
import { getAccessScope, organizationIdScopeWhere } from "@/lib/access-scope";

export default async function CashTransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.CASH_MANAGE);

  const tx = await prisma.bankTransaction.findUnique({
    where: { id },
    include: {
      bankAccount: true,
      cashAccount: true,
      counterparty: true,
      cashFlowArticle: true,
      department: true,
      costCenter: true,
      project: true,
      productService: true,
      allocations: {
        where: { cancelledAt: null },
        include: { accrualDocument: { include: { counterparty: true } } },
      },
    },
  });
  if (!tx) notFound();
  if (!(await isVisible(session, "transaction", id))) notFound();

  const linkedTransfer = tx.transferGroupId
    ? await prisma.bankTransaction.findFirst({
        where: { transferGroupId: tx.transferGroupId, id: { not: tx.id } },
        include: { bankAccount: true, cashAccount: true },
      })
    : null;

  const [bankAccounts, cashAccounts, counterparties, cashFlowArticles, departments, costCenters, projects, productsServices] = await Promise.all([
    prisma.bankAccount.findMany({ where: { OR: [{ isArchived: false }, { id: tx.bankAccountId ?? "" }], ...organizationIdScopeWhere(await getAccessScope(session)) }, orderBy: { bankName: "asc" } }),
    prisma.cashAccount.findMany({ where: { OR: [{ isArchived: false }, { id: tx.cashAccountId ?? "" }], ...organizationIdScopeWhere(await getAccessScope(session)) }, orderBy: { name: "asc" } }),
    prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
    prisma.cashFlowArticle.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.costCenter.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);

  const matchingDirection = tx.direction === "INFLOW" ? "INCOME" : "EXPENSE";
  const candidateDocuments = await prisma.accrualDocument.findMany({
    where: {
      status: "POSTED",
      direction: matchingDirection,
      paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] },
      ...(tx.counterpartyId ? { counterpartyId: tx.counterpartyId } : {}),
    },
    include: { counterparty: true, lines: true, allocations: { where: { cancelledAt: null } } },
    orderBy: { date: "asc" },
    take: 50,
  });

  // In the currency of the operation's account; documents show their remainder in their own currency.
  const txCurrency = transactionCurrency(tx);
  const allocatedTotal = tx.allocations.reduce((acc, a) => acc + allocationTransactionSide(a).toNumber(), 0);
  const remaining = Math.round((Number(tx.amount) - allocatedTotal) * 100) / 100;
  const documentRemainder = (doc: (typeof candidateDocuments)[number]) => {
    const foreign = isForeign(doc.currency);
    const total = documentTotal(doc.lines, foreign).toNumber();
    const allocated = doc.allocations.reduce((acc, a) => acc + allocationDocumentSide(a).toNumber(), 0);
    return formatMoneyIn(total - allocated, doc.currency);
  };
  const anyCurrencyDiffers = candidateDocuments.some((d) => normalizeCurrency(d.currency) !== txCurrency);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            Операция от {tx.operationDate.toLocaleDateString("ru-RU")} · {formatMoneyIn(tx.amount, transactionCurrency(tx))}
          </h1>
          <p>{tx.bankAccount ? `${tx.bankAccount.bankName} · ${tx.bankAccount.accountNumber}` : tx.cashAccount?.name}</p>
        </div>
        <Link href="/cash/transactions" className="btn btn-secondary">
          К списку
        </Link>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p className="form-success" style={{ marginBottom: 14 }}>{notice}</p> : null}

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Классификация операции</h2>
        <form action={updateTransactionClassificationAction.bind(null, tx.id)}>
          <div className="form-grid">
            <label className="field">
              <span>Контрагент</span>
              <select name="counterpartyId" defaultValue={tx.counterpartyId ?? ""}>
                <option value="">—</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName || c.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Статья ДДС</span>
              <select name="cashFlowArticleId" defaultValue={tx.cashFlowArticleId ?? ""}>
                <option value="">—</option>
                {cashFlowArticles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Подразделение</span>
              <select name="departmentId" defaultValue={tx.departmentId ?? ""}>
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ЦФО</span>
              <select name="costCenterId" defaultValue={tx.costCenterId ?? ""}>
                <option value="">—</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Проект</span>
              <select name="projectId" defaultValue={tx.projectId ?? ""}>
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Продукт/услуга</span>
              <select name="productServiceId" defaultValue={tx.productServiceId ?? ""}>
                <option value="">—</option>
                {productsServices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {linkedTransfer ? (
            <p className="text-muted" style={{ marginTop: 14 }}>
              Перевод между собственными счетами — классификация сохраняется сразу у обеих операций перевода.
            </p>
          ) : (
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
              <input type="checkbox" name="isTransfer" defaultChecked={tx.isTransfer} />
              Перевод между собственными счетами
            </label>
          )}
          {tx.purpose ? (
            <p className="text-muted" style={{ marginTop: 10 }}>
              Назначение платежа: {tx.purpose}
            </p>
          ) : null}
          {linkedTransfer ? (
            <p className="text-muted" style={{ marginTop: 10 }}>
              Встречная операция перевода:{" "}
              <Link href={`/cash/transactions/${linkedTransfer.id}`}>
                {linkedTransfer.bankAccount
                  ? `${linkedTransfer.bankAccount.bankName} · ${linkedTransfer.bankAccount.accountNumber}`
                  : linkedTransfer.cashAccount?.name}{" "}
                · {formatMoneyIn(linkedTransfer.amount, transactionCurrency(linkedTransfer))}
              </Link>
            </p>
          ) : null}
          {canManage ? (
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Сохранить классификацию
              </button>
            </div>
          ) : null}
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          Сопоставление с начислениями — остаток {formatMoneyIn(remaining, txCurrency)}
        </h2>
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Документ</th>
                <th>Контрагент</th>
                <th>Сумма сопоставления</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tx.allocations.map((a) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/accruals/${a.accrualDocumentId}`}>
                      {ACCRUAL_DOCUMENT_TYPE_LABELS[a.accrualDocument.documentType]} № {a.accrualDocument.number}
                    </Link>
                  </td>
                  <td>{a.accrualDocument.counterparty.shortName || a.accrualDocument.counterparty.fullName}</td>
                  <td className="mono">
                    {formatMoneyIn(allocationTransactionSide(a), txCurrency)}
                    {a.currencyAmount && normalizeCurrency(a.accrualDocument.currency) !== txCurrency ? (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        = {formatMoneyIn(a.currencyAmount, a.accrualDocument.currency)} по документу
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {canManage ? (
                      <form action={cancelAllocationAction.bind(null, a.id)}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Отменить
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {tx.allocations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Сопоставлений ещё нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {canManage && remaining > 0 ? (
          <form action={allocatePaymentAction.bind(null, tx.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span>Документ начисления ({matchingDirection === "INCOME" ? "доход" : "расход"})</span>
              <select name="accrualDocumentId" required>
                <option value="">— выбрать —</option>
                {candidateDocuments.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    № {doc.number} · {doc.counterparty.shortName || doc.counterparty.fullName} · остаток {documentRemainder(doc)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Сумма, {txCurrency}</span>
              <input type="number" step="0.01" name="amount" defaultValue={remaining.toFixed(2)} required />
            </label>
            {anyCurrencyDiffers ? (
              <p className="text-muted" style={{ gridColumn: "1 / -1", fontSize: 12, margin: 0 }}>
                Сумма — в валюте операции ({txCurrency}). Если документ в другой валюте, она пересчитается по курсу ЦБ на день
                операции; разница с курсом документа попадёт в курсовые разницы.
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary">
              Сопоставить
            </button>
          </form>
        ) : null}
        {candidateDocuments.length === 0 && remaining > 0 ? (
          <p className="text-muted" style={{ marginTop: 10 }}>
            Нет подходящих проведённых и неоплаченных документов{tx.counterpartyId ? " для этого контрагента" : ""}.
          </p>
        ) : null}
      </div>

      {canManage && !tx.batchId ? (
        <details className="card">
          <summary style={{ fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Исправить дату, сумму, направление или счёт
          </summary>
          <form action={updateBankTransactionAction.bind(null, tx.id)} style={{ marginTop: 12 }}>
            <div className="form-grid">
              <label className="field">
                <span>Дата операции</span>
                <input type="date" name="operationDate" defaultValue={tx.operationDate.toISOString().slice(0, 10)} required />
              </label>
              <label className="field">
                <span>Направление</span>
                <select name="direction" defaultValue={tx.direction}>
                  <option value="INFLOW">Поступление</option>
                  <option value="OUTFLOW">Списание</option>
                </select>
              </label>
              <label className="field">
                <span>Сумма</span>
                <input type="number" step="0.01" min="0.01" name="amount" defaultValue={tx.amount.toFixed(2)} required />
              </label>
              {linkedTransfer && transactionCurrency(linkedTransfer) !== transactionCurrency(tx) ? (
                <label className="field">
                  <span>Сумма встречной операции, {transactionCurrency(linkedTransfer)}</span>
                  <input type="number" step="0.01" min="0.01" name="pairAmount" id="pair-amount" defaultValue={linkedTransfer.amount.toFixed(2)} required />
                </label>
              ) : null}
              <label className="field">
                <span>Банковский счёт</span>
                <select name="bankAccountId" defaultValue={tx.bankAccountId ?? ""}>
                  <option value="">—</option>
                  {bankAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bankName} · {a.accountNumber}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Касса</span>
                <select name="cashAccountId" defaultValue={tx.cashAccountId ?? ""}>
                  <option value="">—</option>
                  {cashAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                <span>Назначение платежа</span>
                <input type="text" name="purpose" defaultValue={tx.purpose ?? ""} />
              </label>
            </div>
            <p className="text-muted" style={{ marginTop: 10 }}>
              {linkedTransfer
                ? "Дата, сумма и назначение изменятся и у встречной операции перевода; её направление останется противоположным, счёт — прежним."
                : "Выберите либо банковский счёт, либо кассу."}{" "}
              Если операция сопоставлена с начислениями, сумму нельзя сделать меньше сопоставленной, а направление — поменять.
            </p>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Сохранить исправление
              </button>
            </div>
          </form>
        </details>
      ) : null}

      {canManage ? (
        <details className="card">
          <summary style={{ fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            {linkedTransfer ? "Удалить перевод (обе операции)" : "Удалить операцию"}
          </summary>
          <form action={deleteBankTransactionAction.bind(null, tx.id)} style={{ marginTop: 12 }}>
            <p className="text-muted">
              {tx.allocations.length > 0
                ? "Сначала отмените сопоставления с начислениями ниже — иначе у документов незаметно пропала бы оплата."
                : tx.batchId
                  ? "Операция загружена из выписки. После удаления повторная загрузка той же выписки добавит её снова — так исправляют выписку, загруженную не на тот счёт."
                  : "Удаление нельзя отменить; сведения об операции останутся в журнале аудита."}
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13 }}>
              <input type="checkbox" name="confirm" required />
              Да, удалить {linkedTransfer ? "обе операции перевода" : "операцию"}
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-danger" disabled={tx.allocations.length > 0}>
                Удалить
              </button>
            </div>
          </form>
        </details>
      ) : null}
    </div>
  );
}
