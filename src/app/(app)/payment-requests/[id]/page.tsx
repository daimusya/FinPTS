import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import {
  buildApprovalTimeline,
  DECISION_COMMENT_MAX_LENGTH,
  type TimelineState,
} from "@/lib/payment-requests/approval";
import { PAYMENT_REQUEST_STATUS_BADGE, PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payment-requests/labels";
import {
  approvePaymentRequestAction,
  cancelPaymentRequestAction,
  markPaymentRequestPaidAction,
  rejectPaymentRequestAction,
  reschedulePaymentRequestAction,
} from "../actions";
import { localDateKey, requestPlacement } from "@/lib/payment-calendar";

const STATE_LABELS: Record<TimelineState, string> = {
  approved: "Согласовано",
  rejected: "Отклонено",
  current: "Ждёт решения",
  waiting: "Впереди",
  not_reached: "Не понадобилось",
};

const STATE_BADGE: Record<TimelineState, string> = {
  approved: "badge-active",
  rejected: "badge-danger",
  current: "badge-warning",
  waiting: "badge-archived",
  not_reached: "badge-archived",
};

/** Due dates are stored as UTC midnight: show them without shifting by the time zone. */
const dueDay = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "UTC" });

const dateTime = (d: Date) =>
  d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function PaymentRequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;
  const { id } = await params;
  const { error, notice } = await searchParams;

  const request = await prisma.paymentRequest.findUnique({
    where: { id },
    include: {
      organization: true,
      counterparty: true,
      cashFlowArticle: true,
      createdBy: true,
      route: { include: { steps: { include: { role: true } } } },
      approvals: { include: { approver: true } },
      reschedules: { include: { changedBy: true }, orderBy: { changedAt: "asc" } },
    },
  });
  if (!request) notFound();

  const isAdmin = hasPermission(session, PERMISSIONS.ADMIN_FULL);
  const canApprove = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE);
  const canPay = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const canReschedule = (isAdmin || canApprove || canPay) && requestPlacement(request.status, true).movable;
  const todayKey = localDateKey();

  const steps = request.route?.steps ?? [];
  const currentStepRow = steps.find((s) => s.stepOrder === request.currentStep);
  const pending = request.status === "PENDING_APPROVAL";
  const canDecide =
    pending &&
    (!request.route
      ? canApprove
      : isAdmin ||
        (currentStepRow
          ? Boolean(await prisma.userRole.findFirst({ where: { userId: session.userId, roleId: currentStepRow.roleId } }))
          : false));

  const timeline = buildApprovalTimeline({
    steps: steps.map((s) => ({ stepOrder: s.stepOrder, roleName: s.role.name })),
    decisions: request.approvals.map((a) => ({
      stepOrder: a.stepOrder,
      decision: a.decision,
      approverName: a.approver.fullName,
      decidedAt: a.decidedAt,
      comment: a.comment,
    })),
    currentStep: request.currentStep,
    status: request.status,
  });

  const counterpartyName = request.counterparty ? request.counterparty.shortName || request.counterparty.fullName : "—";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            Заявка на оплату · {formatMoney(request.amount)}
          </h1>
          <p>
            {counterpartyName} · срок оплаты {dueDay(request.dueDate)}{" "}
            <span className={`badge ${PAYMENT_REQUEST_STATUS_BADGE[request.status]}`}>
              {PAYMENT_REQUEST_STATUS_LABELS[request.status]}
            </span>
          </p>
        </div>
        <Link href="/payment-requests" className="btn btn-secondary">
          К списку
        </Link>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p className="form-success" style={{ marginBottom: 14 }}>{notice}</p> : null}

      <div className="card">
        <dl className="detail-list">
          <dt>Организация</dt>
          <dd>{request.organization.shortName || request.organization.name}</dd>
          <dt>Контрагент</dt>
          <dd>{counterpartyName}</dd>
          <dt>Статья ДДС</dt>
          <dd>{request.cashFlowArticle?.name ?? "—"}</dd>
          <dt>Сумма</dt>
          <dd className="mono">{formatMoney(request.amount)}</dd>
          <dt>Срок оплаты</dt>
          <dd>{dueDay(request.dueDate)}</dd>
          <dt>Создал</dt>
          <dd>
            {request.createdBy.fullName}, {dateTime(request.createdAt)}
          </dd>
          <dt>Комментарий автора</dt>
          <dd style={{ whiteSpace: "pre-wrap" }}>{request.comment ?? "—"}</dd>
          <dt>Маршрут</dt>
          <dd>{request.route ? request.route.name : "Одна ступень (подходящего маршрута не было)"}</dd>
        </dl>
      </div>

      {canReschedule || request.reschedules.length > 0 ? (
        <div className="card" id="due-date">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            Срок оплаты: {dueDay(request.dueDate)}
            {request.dueDate.toISOString().slice(0, 10) < todayKey && requestPlacement(request.status, true).movable ? (
              <span className="badge badge-danger" style={{ marginLeft: 8 }}>
                Просрочен
              </span>
            ) : null}
          </h2>
          {request.reschedules.length > 0 ? (
            <ul className="reschedule-list">
              {request.reschedules.map((r) => (
                <li key={r.id}>
                  <span className="mono">
                    {dueDay(r.fromDate)} → {dueDay(r.toDate)}
                  </span>{" "}
                  <span className="text-muted">
                    {r.changedBy.fullName}, {dateTime(r.changedAt)}
                  </span>
                  {r.reason ? <div className="approval-comment" style={{ marginTop: 4 }}>{r.reason}</div> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canReschedule ? (
            <form action={reschedulePaymentRequestAction.bind(null, request.id)} className="form-grid" style={{ alignItems: "flex-end", marginTop: 10 }}>
              <label className="field">
                <span>Новый срок оплаты</span>
                <input type="date" name="dueDate" min={todayKey} defaultValue={request.dueDate.toISOString().slice(0, 10)} required />
              </label>
              <label className="field" style={{ gridColumn: "span 2" }}>
                <span>Причина переноса (необязательно)</span>
                <input type="text" name="reason" maxLength={500} placeholder="Например: ждём поступления от заказчика" />
              </label>
              <button type="submit" className="btn btn-secondary">
                Перенести срок
              </button>
            </form>
          ) : null}
          {canReschedule ? (
            <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
              Срок можно передвинуть и в <Link href={`/payment-calendar?month=${request.dueDate.toISOString().slice(0, 7)}`}>платёжном календаре</Link> — перетащив заявку на другой день. Статус и согласование при переносе не меняются.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>История согласования</h2>
        <ol className="approval-timeline">
          {timeline.map((entry) => (
            <li key={entry.stepOrder ?? "single"} className={`approval-step approval-step--${entry.state}`}>
              <div className="approval-step__head">
                <strong>
                  {entry.stepOrder === null
                    ? "Согласование"
                    : `Шаг ${entry.stepOrder}${entry.roleName ? `: ${entry.roleName}` : ""}`}
                </strong>
                <span className={`badge ${STATE_BADGE[entry.state]}`}>{STATE_LABELS[entry.state]}</span>
              </div>
              {entry.removedFromRoute ? (
                <p className="text-muted" style={{ fontSize: 12 }}>
                  Этого шага в маршруте уже нет — маршрут изменили после решения.
                </p>
              ) : null}
              {entry.decisions.map((d, i) => (
                <div key={i} className="approval-step__decision">
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    {d.decision === "rejected" ? "Отклонил" : "Согласовал"}: {d.approverName}, {dateTime(d.decidedAt)}
                  </div>
                  {d.comment ? <blockquote className="approval-comment">{d.comment}</blockquote> : null}
                </div>
              ))}
              {entry.state === "current" && !canDecide ? (
                <p className="text-muted" style={{ fontSize: 12 }}>
                  Решение принимает {entry.roleName ? `роль «${entry.roleName}»` : "пользователь с правом согласования заявок"}.
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      {canDecide ? (
        <div className="card" id="decision">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            Ваше решение{request.route ? ` — шаг ${request.currentStep}` : ""}
          </h2>
          <form action={approvePaymentRequestAction.bind(null, request.id)}>
            <input type="hidden" name="expectedStep" value={request.currentStep} />
            <input type="hidden" name="returnTo" value="detail" />
            <label className="field">
              <span>Комментарий (при отклонении обязателен)</span>
              <textarea name="comment" rows={3} maxLength={DECISION_COMMENT_MAX_LENGTH} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Согласовать
              </button>
              <button type="submit" className="btn btn-danger" formAction={rejectPaymentRequestAction.bind(null, request.id)}>
                Отклонить
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {(canPay && request.status === "APPROVED") || (canApprove && (pending || request.status === "APPROVED")) ? (
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canPay && request.status === "APPROVED" ? (
            <form action={markPaymentRequestPaidAction.bind(null, request.id)}>
              <input type="hidden" name="returnTo" value="detail" />
              <button type="submit" className="btn btn-secondary">
                Отметить оплаченной
              </button>
            </form>
          ) : null}
          {canApprove && (pending || request.status === "APPROVED") ? (
            <form action={cancelPaymentRequestAction.bind(null, request.id)}>
              <input type="hidden" name="returnTo" value="detail" />
              <button type="submit" className="btn btn-ghost">
                Отменить заявку
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
