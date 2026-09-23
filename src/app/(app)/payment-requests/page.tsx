import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { roleForStep, totalSteps, type ApprovalRouteCandidate } from "@/lib/payment-requests/approval";
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

export default async function PaymentRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;
  const { error } = await searchParams;
  const canApprove = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE);
  const canPay = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const canCreate = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_CREATE);
  const isAdmin = hasPermission(session, PERMISSIONS.ADMIN_FULL);

  const [requests, myRoleRows] = await Promise.all([
    prisma.paymentRequest.findMany({
      orderBy: { dueDate: "asc" },
      include: {
        organization: true,
        counterparty: true,
        cashFlowArticle: true,
        createdBy: true,
        route: { include: { steps: { include: { role: true } } } },
      },
    }),
    prisma.userRole.findMany({ where: { userId: session.userId }, select: { roleId: true } }),
  ]);
  const myRoleIds = new Set(myRoleRows.map((r) => r.roleId));

  function toRouteCandidate(route: NonNullable<(typeof requests)[number]["route"]>): ApprovalRouteCandidate {
    return {
      id: route.id,
      priority: route.priority,
      minAmount: route.minAmount,
      maxAmount: route.maxAmount,
      organizationId: route.organizationId,
      steps: route.steps.map((s) => ({ stepOrder: s.stepOrder, roleId: s.roleId })),
    };
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Заявки на оплату</h1>
          <p>
            Заявка проходит согласование (по настроенному маршруту, если он подходит по сумме/организации, иначе
            одной ступенью), затем оплачивается и попадает в платёжный календарь.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canApprove ? (
            <Link href="/admin/payment-approval-routes" className="btn btn-secondary">
              Маршруты согласования
            </Link>
          ) : null}
          {canCreate ? (
            <Link href="/payment-requests/new" className="btn btn-primary">
              Новая заявка
            </Link>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error">{error}</p>
        </div>
      ) : null}

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
              <th>Маршрут</th>
              <th>Статус</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {requests.map((req) => {
              const routeCandidate = req.route ? toRouteCandidate(req.route) : null;
              const requiredRoleId = routeCandidate ? roleForStep(routeCandidate, req.currentStep) : null;
              const canActOnStep =
                req.status !== "PENDING_APPROVAL"
                  ? false
                  : !req.route
                    ? canApprove
                    : isAdmin || (requiredRoleId !== null && myRoleIds.has(requiredRoleId));
              const currentStepRoleName = req.route?.steps.find((s) => s.stepOrder === req.currentStep)?.role.name;

              return (
                <tr key={req.id}>
                  <td className="mono">{req.dueDate.toLocaleDateString("ru-RU")}</td>
                  <td>{req.organization.shortName || req.organization.name}</td>
                  <td>{req.counterparty ? req.counterparty.shortName || req.counterparty.fullName : "—"}</td>
                  <td>{req.cashFlowArticle?.name ?? "—"}</td>
                  <td className="mono">{formatMoney(req.amount)}</td>
                  <td>{req.createdBy.fullName}</td>
                  <td>
                    {routeCandidate ? (
                      <span>
                        Шаг {req.currentStep}/{totalSteps(routeCandidate)}
                        {req.status === "PENDING_APPROVAL" && currentStepRoleName ? `: ${currentStepRoleName}` : ""}
                      </span>
                    ) : (
                      <span className="text-muted">одна ступень</span>
                    )}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[req.status]}`}>{STATUS_LABELS[req.status]}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {canActOnStep ? (
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
              );
            })}
            {requests.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-state">
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
