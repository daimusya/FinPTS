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
import type { PaymentRequestStatus } from "@prisma/client";
import { pageWindow } from "@/lib/paging";
import { Pager } from "@/components/pager";
import { textSearchWhere } from "@/lib/text-search";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";

/** «В работе» — всё, с чем ещё что-то делают (отклонённую автор может доработать); «Завершённые» — оплаченные и отменённые. */
const IN_WORK: PaymentRequestStatus[] = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "RETURNED", "REJECTED"];
const DONE: PaymentRequestStatus[] = ["PAID", "CANCELLED"];
const DONE_PAGE_SIZE = 100;

export default async function PaymentRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; view?: string; page?: string; q?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;
  const { error, view, page, q } = singleParams(await searchParams);
  const showDone = view === "done";
  const canApprove = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE);
  const canPay = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const canCreate = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_CREATE);
  const isAdmin = hasPermission(session, PERMISSIONS.ADMIN_FULL);

  const today = new Date();
  const scope = await getAccessScope(session);
  // Only the organizations this user may see.
  const scopeWhere = {
    AND: [paymentRequestScopeWhere(scope), textSearchWhere(["comment", "counterparty.fullName", "counterparty.shortName", "counterparty.inn", "organization.name"], q)],
  };
  const [inWorkCount, doneCount] = await Promise.all([
    prisma.paymentRequest.count({ where: { ...scopeWhere, status: { in: IN_WORK } } }),
    prisma.paymentRequest.count({ where: { ...scopeWhere, status: { in: DONE } } }),
  ]);
  // Requests in work are all shown, nearest due date first; finished ones — newest first, by pages.
  const window = showDone ? pageWindow(doneCount, page, DONE_PAGE_SIZE) : null;
  const [requests, myRoleRows, myDelegations] = await Promise.all([
    prisma.paymentRequest.findMany({
      where: { ...scopeWhere, status: { in: showDone ? DONE : IN_WORK } },
      orderBy: showDone ? [{ dueDate: "desc" }, { id: "desc" }] : [{ dueDate: "asc" }, { id: "asc" }],
      ...(window ? { skip: window.skip, take: window.take } : {}),
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

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <form style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {showDone ? <input type="hidden" name="view" value="done" /> : null}
          <input type="search" name="q" id="requests-search" defaultValue={q ?? ""} placeholder="Контрагент, ИНН, комментарий" style={{ minWidth: 240 }} />
          <SubmitButton className="btn btn-secondary btn-sm">
            Найти
          </SubmitButton>
          {q ? (
            <Link href={showDone ? "/payment-requests?view=done" : "/payment-requests"} className="btn btn-ghost btn-sm">
              Сбросить
            </Link>
          ) : null}
        </form>
        <Link href="/payment-requests" className={`btn btn-sm ${showDone ? "btn-ghost" : "btn-secondary"}`} aria-current={showDone ? undefined : "page"}>
          В работе ({inWorkCount})
        </Link>
        <Link href="/payment-requests?view=done" className={`btn btn-sm ${showDone ? "btn-secondary" : "btn-ghost"}`} aria-current={showDone ? "page" : undefined}>
          Завершённые ({doneCount})
        </Link>
        {window ? (
          <span className="text-muted" style={{ fontSize: 12 }}>
            {window.caption}
          </span>
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
                            <SubmitButton className="btn btn-primary btn-sm">
                              Согласовать
                            </SubmitButton>
                          </form>
                          {/* Rejection and return for rework need a reason, so they are done on the request page. */}
                          <Link href={`/payment-requests/${req.id}#decision`} className="btn btn-danger btn-sm">
                            Вернуть / отклонить…
                          </Link>
                        </>
                      ) : null}
                      {canPay && req.status === "APPROVED" ? (
                        <form action={markPaymentRequestPaidAction.bind(null, req.id)}>
                          <SubmitButton className="btn btn-secondary btn-sm">
                            Отметить оплаченной
                          </SubmitButton>
                        </form>
                      ) : null}
                      {canApprove && (req.status === "PENDING_APPROVAL" || req.status === "APPROVED" || req.status === "RETURNED") ? (
                        <form action={cancelPaymentRequestAction.bind(null, req.id)}>
                          <ConfirmSubmitButton className="btn btn-ghost btn-sm" message="Отменить заявку на оплату? Вернуть отменённую заявку в работу нельзя.">
                            Отменить
                          </ConfirmSubmitButton>
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
                  {q ? `По запросу «${q}» заявок нет.` : showDone ? "Оплаченных и отменённых заявок пока нет." : "Заявок в работе нет."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {window ? <Pager window={window} basePath="/payment-requests" params={{ view: "done", q }} /> : null}
    </div>
  );
}
