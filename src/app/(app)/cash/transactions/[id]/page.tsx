import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { ACCRUAL_DOCUMENT_TYPE_LABELS } from "@/lib/accruals/labels";
import { allocatePaymentAction, updateTransactionClassificationAction, cancelAllocationAction } from "../../actions";

export default async function CashTransactionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
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

  const [counterparties, cashFlowArticles, departments, costCenters, projects, productsServices] = await Promise.all([
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

  const allocatedTotal = tx.allocations.reduce((acc, a) => acc + Number(a.amount), 0);
  const remaining = Number(tx.amount) - allocatedTotal;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            Операция от {tx.operationDate.toLocaleDateString("ru-RU")} · {formatMoney(tx.amount)}
          </h1>
          <p>{tx.bankAccount ? `${tx.bankAccount.bankName} · ${tx.bankAccount.accountNumber}` : tx.cashAccount?.name}</p>
        </div>
        <Link href="/cash/transactions" className="btn btn-secondary">
          К списку
        </Link>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}

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
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" name="isTransfer" defaultChecked={tx.isTransfer} />
            Перевод между собственными счетами
          </label>
          {tx.purpose ? (
            <p className="text-muted" style={{ marginTop: 10 }}>
              Назначение платежа: {tx.purpose}
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
          Сопоставление с начислениями — остаток {formatMoney(remaining)}
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
                  <td className="mono">{formatMoney(a.amount)}</td>
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
                {candidateDocuments.map((doc) => {
                  const total = doc.lines.reduce((acc, l) => acc + Number(l.amount), 0);
                  const allocated = doc.allocations.reduce((acc, a) => acc + Number(a.amount), 0);
                  return (
                    <option key={doc.id} value={doc.id}>
                      № {doc.number} · {doc.counterparty.shortName || doc.counterparty.fullName} · остаток{" "}
                      {formatMoney(total - allocated)}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="field">
              <span>Сумма</span>
              <input type="number" step="0.01" name="amount" defaultValue={remaining.toFixed(2)} required />
            </label>
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
    </div>
  );
}
