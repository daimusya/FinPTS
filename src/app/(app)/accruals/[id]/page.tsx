import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import {
  ACCRUAL_DIRECTION_LABELS,
  ACCRUAL_DOCUMENT_TYPE_LABELS,
  ACCRUAL_STATUS_LABELS,
  PAYMENT_STATUS_BADGE,
  PAYMENT_STATUS_LABELS,
} from "@/lib/accruals/labels";
import { cancelAllocationAction } from "../../cash/actions";
import { postAccrualDocumentAction, cancelAccrualDocumentAction } from "../actions";

export default async function AccrualDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.ACCRUALS_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.ACCRUALS_MANAGE);

  const doc = await prisma.accrualDocument.findUnique({
    where: { id },
    include: {
      organization: true,
      counterparty: true,
      contract: true,
      responsible: true,
      lines: { include: { department: true, costCenter: true, project: true, productService: true, pnlArticle: true } },
      allocations: {
        where: { cancelledAt: null },
        include: { bankTransaction: { include: { bankAccount: true, cashAccount: true } } },
      },
    },
  });
  if (!doc) notFound();

  const total = doc.lines.reduce((acc, l) => acc + Number(l.amount), 0);
  const allocated = doc.allocations.reduce((acc, a) => acc + Number(a.amount), 0);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            {ACCRUAL_DOCUMENT_TYPE_LABELS[doc.documentType]} № {doc.number} от {doc.date.toLocaleDateString("ru-RU")}
          </h1>
          <p>
            {doc.organization.shortName || doc.organization.name} · {doc.counterparty.shortName || doc.counterparty.fullName} ·{" "}
            {ACCRUAL_DIRECTION_LABELS[doc.direction]}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/accruals" className="btn btn-secondary">
            К списку
          </Link>
          {canManage && doc.status === "DRAFT" ? (
            <>
              <Link href={`/accruals/${doc.id}/edit`} className="btn btn-secondary">
                Изменить
              </Link>
              <form action={postAccrualDocumentAction.bind(null, doc.id)}>
                <button type="submit" className="btn btn-primary">
                  Провести
                </button>
              </form>
            </>
          ) : null}
          {canManage && doc.status !== "CANCELLED" ? (
            <form action={cancelAccrualDocumentAction.bind(null, doc.id)}>
              <button type="submit" className="btn btn-danger">
                Отменить
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Сумма документа</div>
          <div className="stat-value">{formatMoney(total)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Оплачено</div>
          <div className="stat-value">{formatMoney(allocated)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Статус проведения</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            <span className="badge badge-orange">{ACCRUAL_STATUS_LABELS[doc.status]}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Статус оплаты</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            <span className={`badge ${PAYMENT_STATUS_BADGE[doc.paymentStatus]}`}>
              {PAYMENT_STATUS_LABELS[doc.paymentStatus]}
            </span>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Строки документа</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Подразделение</th>
                <th>ЦФО</th>
                <th>Проект</th>
                <th>Продукт/услуга</th>
                <th>Статья ОПиУ</th>
                <th>Сумма</th>
                <th>НДС</th>
                <th>Описание</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.department?.name ?? "—"}</td>
                  <td>{line.costCenter?.name ?? "—"}</td>
                  <td>{line.project?.name ?? "—"}</td>
                  <td>{line.productService?.name ?? "—"}</td>
                  <td>{line.pnlArticle?.name ?? "—"}</td>
                  <td className="mono">{formatMoney(line.amount)}</td>
                  <td className="mono">{line.vatAmount ? formatMoney(line.vatAmount) : "—"}</td>
                  <td>{line.description ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Сопоставленные платежи</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата операции</th>
                <th>Счёт/касса</th>
                <th>Сумма сопоставления</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {doc.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.bankTransaction.operationDate.toLocaleDateString("ru-RU")}</td>
                  <td>{a.bankTransaction.bankAccount?.bankName ?? a.bankTransaction.cashAccount?.name}</td>
                  <td className="mono">{formatMoney(a.amount)}</td>
                  <td>
                    {canManage ? (
                      <form action={cancelAllocationAction.bind(null, a.id)}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Отменить сопоставление
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {doc.allocations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Платежи ещё не сопоставлены.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
