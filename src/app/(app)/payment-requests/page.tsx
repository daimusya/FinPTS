import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import {
  approvePaymentRequestAction,
  cancelPaymentRequestAction,
  markPaymentRequestPaidAction,
  rejectPaymentRequestAction,
} from "./actions";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  PENDING_APPROVAL: "На согласовании",
  APPROVED: "Согласована",
  REJECTED: "Отклонена",
  PAID: "Оплачена",
  CANCELLED: "Отменена",
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "badge-archived",
  PENDING_APPROVAL: "badge-warning",
  APPROVED: "badge-active",
  REJECTED: "badge-danger",
  PAID: "badge-orange",
  CANCELLED: "badge-archived",
};

export default async function PaymentRequestsPage() {
  const session = await getSession();
  if (!session) return null;
  const canApprove = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE);
  const canPay = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const canCreate = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_CREATE);

  const requests = await prisma.paymentRequest.findMany({
    orderBy: { dueDate: "asc" },
    include: { organization: true, counterparty: true, cashFlowArticle: true, createdBy: true },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Заявки на оплату</h1>
          <p>Заявка проходит согласование, затем оплачивается и попадает в платёжный календарь.</p>
        </div>
        {canCreate ? (
          <Link href="/payment-requests/new" className="btn btn-primary">
            Новая заявка
          </Link>
        ) : null}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Срок оплаты</th>
              <th>Организация</th>
              <th>Контрагент</th>
              <th>Статья</th>
              <th>Сумма</th>
              <th>Создал</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => (
              <tr key={req.id}>
                <td className="mono">{req.dueDate.toLocaleDateString("ru-RU")}</td>
                <td>{req.organization.shortName || req.organization.name}</td>
                <td>{req.counterparty ? req.counterparty.shortName || req.counterparty.fullName : "—"}</td>
                <td>{req.cashFlowArticle?.name ?? "—"}</td>
                <td className="mono">{formatMoney(req.amount)}</td>
                <td>{req.createdBy.fullName}</td>
                <td>
                  <span className={`badge ${STATUS_BADGE[req.status]}`}>{STATUS_LABELS[req.status]}</span>
                </td>
                <td>
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {canApprove && req.status === "PENDING_APPROVAL" ? (
                      <>
                        <form action={approvePaymentRequestAction.bind(null, req.id)}>
                          <button type="submit" className="btn btn-primary btn-sm">
                            Согласовать
                          </button>
                        </form>
                        <form action={rejectPaymentRequestAction.bind(null, req.id)}>
                          <button type="submit" className="btn btn-danger btn-sm">
                            Отклонить
                          </button>
                        </form>
                      </>
                    ) : null}
                    {canPay && req.status === "APPROVED" ? (
                      <form action={markPaymentRequestPaidAction.bind(null, req.id)}>
                        <button type="submit" className="btn btn-secondary btn-sm">
                          Отметить оплаченной
                        </button>
                      </form>
                    ) : null}
                    {canApprove && (req.status === "PENDING_APPROVAL" || req.status === "APPROVED") ? (
                      <form action={cancelPaymentRequestAction.bind(null, req.id)}>
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Отменить
                        </button>
                      </form>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
            {requests.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-state">
                  Заявок пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
