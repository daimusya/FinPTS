import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { roleForStep, totalSteps, type ApprovalRouteCandidate } from "@/lib/payment-requests/approval";
import { approvePaymentRequestAction, cancelPaymentRequestAction, markPaymentRequestPaidAction } from "./actions";
import { PAYMENT_REQUEST_STATUS_BADGE as STATUS_BADGE, PAYMENT_REQUEST_STATUS_LABELS as STATUS_LABELS } from "@/lib/payment-requests/labels";
import { formatMoneyIn } from "@/lib/currency";
import { getAccessScope, paymentRequestScopeWhere } from "@/lib/access-scope";
import { isDelegationActive } from "@/lib/payment-requests/delegation";

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

  const today = new Date();
  const scope = await getAccessScope(session);
  const [requests, myRoleRows, myDelegations] = await Promise.all([
    prisma.paymentRequest.findMany({
      // Only the organizations this user may see.
      where: paymentRequestScopeWhere(scope),
      orderBy: { dueDate: "asc" },
      include: {
        organization: true,
        counterparty: true,
        cashFlowArticle: true,
        createdBy: true,
        route: { include: { steps: { include: { role: true } } } },
        approvals: { orderBy: { decidedAt: "desc" }, take: 1 },
        _count: { select: { reschedules: true } },
        parts: { select: { paidAt: true } },
      },
    }),
    prisma.userRole.findMany({ where: { userId: session.userId }, select: { roleId: true } }),
    prisma.approvalDelegation.findMany({
      where: { toUserId: session.userId },
      include: {
        fromUser: {
          select: {
            fullName: true,
            roles: { select: { roleId: true, role: { select: { permissions: { select: { permission: { select: { code: true } } } } } } } },
          },
        },
      },
    }),
  ]);
  // Whom I stand in for today: their step roles count as mine, and their right to approve single-step requests.
  const activeDelegations = myDelegations.filter((d) => isDelegationActive(d, today));
  const myRoleIds = new Set([...myRoleRows.map((r) => r.roleId), ...activeDelegations.flatMap((d) => d.fromUser.roles.map((r) => r.roleId))]);
  const approvesByDelegation = activeDelegations.some((d) =>
    d.fromUser.roles.some((r) => r.role.permissions.some((p) => p.permission.code === PERMISSIONS.PAYMENT_REQUEST_APPROVE)),
  );

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
      {activeDelegations.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p>
            Сегодня вы замещаете: {activeDelegations.map((d) => d.fromUser.fullName).join(", ")} — их шаги согласования доступны вам.
          </p>
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
                    ? canApprove || approvesByDelegation
                    : isAdmin || (requiredRoleId !== null && myRoleIds.has(requiredRoleId));
              const currentStepRoleName = req.route?.steps.find((s) => s.stepOrder === req.currentStep)?.role.name;

              return (
                <tr key={req.id}>
                  <td className="mono">
                    <Link href={`/payment-requests/${req.id}`}>{req.dueDate.toLocaleDateString("ru-RU", { timeZone: "UTC" })}</Link>
                    {req.dueTime ? <span className="text-muted"> в {req.dueTime}</span> : null}
                    {req._count.reschedules > 0 ? (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        перенесён{req._count.reschedules > 1 ? ` ×${req._count.reschedules}` : ""}
                      </div>
                    ) : null}
                  </td>
                  <td>{req.organization.shortName || req.organization.name}</td>
                  <td>{req.counterparty ? req.counterparty.shortName || req.counterparty.fullName : "—"}</td>
                  <td>{req.cashFlowArticle?.name ?? "—"}</td>
                  <td className="mono">
                    {formatMoneyIn(req.amount, req.currency)}
                    {req.parts.length > 0 ? (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        частями: оплачено {req.parts.filter((p) => p.paidAt).length} из {req.parts.length}
                      </div>
                    ) : null}
                  </td>
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
                    {req.approvals[0]?.comment ? (
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 220 }} title={req.approvals[0].comment}>
                        «{req.approvals[0].comment.length > 60 ? `${req.approvals[0].comment.slice(0, 60)}…` : req.approvals[0].comment}»
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      {canActOnStep ? (
                        <>
                          <form action={approvePaymentRequestAction.bind(null, req.id)}>
                            <input type="hidden" name="expectedStep" value={req.currentStep} />
                            <button type="submit" className="btn btn-primary btn-sm">
                              Согласовать
                            </button>
                          </form>
                          {/* Rejection and return for rework need a reason, so they are done on the request page. */}
                          <Link href={`/payment-requests/${req.id}#decision`} className="btn btn-danger btn-sm">
                            Вернуть / отклонить…
                          </Link>
                        </>
                      ) : null}
                      {canPay && req.status === "APPROVED" ? (
                        <form action={markPaymentRequestPaidAction.bind(null, req.id)}>
                          <button type="submit" className="btn btn-secondary btn-sm">
                            Отметить оплаченной
                          </button>
                        </form>
                      ) : null}
                      {canApprove && (req.status === "PENDING_APPROVAL" || req.status === "APPROVED" || req.status === "RETURNED") ? (
                        <form action={cancelPaymentRequestAction.bind(null, req.id)}>
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Отменить
                          </button>
                        </form>
                      ) : null}
                      {(req.status === "RETURNED" || req.status === "REJECTED") && (req.createdById === session.userId || isAdmin) ? (
                        <Link href={`/payment-requests/${req.id}#rework`} className="btn btn-secondary btn-sm">
                          Доработать
                        </Link>
                      ) : null}
                      <Link href={`/payment-requests/${req.id}`} className="btn btn-ghost btn-sm">
                        История
                      </Link>
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
