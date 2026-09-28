import Decimal from "decimal.js";
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
  savePaymentScheduleAction,
  removePaymentScheduleAction,
  markPaymentPartPaidAction,
  assignRequestAccountAction,
} from "../actions";
import { accountKey, localDateKey, requestPlacement } from "@/lib/payment-calendar";
import { scheduleSummary, suggestSplit } from "@/lib/payment-requests/parts";
import { canPlanRequests } from "@/lib/payment-plan/service";
import { PaymentScheduleEditor } from "@/components/payment-schedule-editor";
import { PaymentAccountOptions } from "@/components/payment-account-options";

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
      counterparty: { include: { bankDetails: { where: { isPrimary: true }, take: 1 } } },
      cashFlowArticle: true,
      createdBy: true,
      route: { include: { steps: { include: { role: true } } } },
      approvals: { include: { approver: true } },
      reschedules: { include: { changedBy: true }, orderBy: { changedAt: "asc" } },
      parts: { include: { paidBy: true }, orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }] },
      payBankAccount: true,
      payCashAccount: true,
    },
  });
  if (!request) notFound();

  const isAdmin = hasPermission(session, PERMISSIONS.ADMIN_FULL);
  const canApprove = hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE);
  const canPay = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const movable = requestPlacement(request.status, true).movable;
  const canReschedule = canPlanRequests(session) && movable;
  const todayKey = localDateKey();
  const hasParts = request.parts.length > 0;
  const summary = scheduleSummary(request.parts);
  const unpaidParts = request.parts.filter((part) => !part.paidAt);
  const partNumber = new Map(request.parts.map((part, i) => [part.id, i + 1]));
  const [orgBankAccounts, orgCashAccounts] = canReschedule
    ? await Promise.all([
        prisma.bankAccount.findMany({ where: { organizationId: request.organizationId, isArchived: false }, orderBy: { bankName: "asc" } }),
        prisma.cashAccount.findMany({ where: { organizationId: request.organizationId, isArchived: false }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  const payAccountName = request.payBankAccount
    ? `${request.payBankAccount.bankName} · ${request.payBankAccount.accountNumber}`
    : (request.payCashAccount?.name ?? null);
  const firstDueKey = request.dueDate.toISOString().slice(0, 10);

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
  const primaryAccount = request.counterparty?.bankDetails[0] ?? null;

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
          <dt>Реквизиты для оплаты</dt>
          <dd>
            {primaryAccount ? (
              <span className="mono">
                {primaryAccount.bankName} · р/с {primaryAccount.account}
                {primaryAccount.bik ? ` · БИК ${primaryAccount.bik}` : ""}
              </span>
            ) : request.counterparty ? (
              <span className="text-muted">
                основной счёт контрагента не указан —{" "}
                <Link href={`/master-data/counterparties/${request.counterparty.id}/edit#bank-details`}>добавить</Link>
              </span>
            ) : (
              "—"
            )}
          </dd>
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

      <div className="card" id="due-date">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
          План оплаты: {hasParts ? `частями, ${summary.total} ч.` : `одним платежом ${dueDay(request.dueDate)}`}
          {!hasParts && firstDueKey < todayKey && movable ? (
            <span className="badge badge-danger" style={{ marginLeft: 8 }}>
              Просрочен
            </span>
          ) : null}
        </h2>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
          Счёт оплаты: {payAccountName ?? "не назначен"}
          {hasParts
            ? ` · оплачено ${formatMoney(summary.paidAmount)} из ${formatMoney(request.amount)}, осталось ${formatMoney(summary.remainingAmount)}`
            : ""}
        </p>

        {hasParts ? (
          <div className="table-wrap" style={{ marginBottom: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Часть</th>
                  <th>Срок</th>
                  <th>Сумма</th>
                  <th>Оплата</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {request.parts.map((part, i) => (
                  <tr key={part.id}>
                    <td>{i + 1}</td>
                    <td className="mono">
                      {dueDay(part.dueDate)}
                      {!part.paidAt && part.dueDate.toISOString().slice(0, 10) < todayKey ? (
                        <span className="badge badge-danger" style={{ marginLeft: 6 }}>
                          просрочена
                        </span>
                      ) : null}
                    </td>
                    <td className="mono">{formatMoney(part.amount)}</td>
                    <td>
                      {part.paidAt ? (
                        <span>
                          <span className="badge badge-active">Оплачена</span>{" "}
                          <span className="text-muted" style={{ fontSize: 12 }}>
                            {part.paidBy?.fullName}, {dateTime(part.paidAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">ждёт оплаты</span>
                      )}
                    </td>
                    <td>
                      {!part.paidAt && canPay && request.status === "APPROVED" ? (
                        <form action={markPaymentPartPaidAction.bind(null, request.id, part.id)}>
                          <button type="submit" className="btn btn-secondary btn-sm">
                            Оплачено
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {canReschedule && !hasParts ? (
          <form action={reschedulePaymentRequestAction.bind(null, request.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
            <label className="field">
              <span>Новый срок оплаты</span>
              <input type="date" name="dueDate" min={todayKey} defaultValue={firstDueKey} required />
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

        {canReschedule && (!hasParts || unpaidParts.length > 0) ? (
          <details className="plan-details">
            <summary>{hasParts ? "Изменить неоплаченные части" : "Разбить оплату на части"}</summary>
            <PaymentScheduleEditor
              action={savePaymentScheduleAction.bind(null, request.id)}
              toSchedule={(hasParts ? summary.remainingAmount : new Decimal(request.amount.toString())).toFixed(2)}
              initialRows={
                hasParts
                  ? unpaidParts.map((part) => ({ id: part.id, dueDate: part.dueDate.toISOString().slice(0, 10), amount: part.amount.toFixed(2) }))
                  : suggestSplit(request.amount.toString(), firstDueKey < todayKey ? todayKey : firstDueKey, 2)
              }
              todayKey={todayKey}
              submitLabel={hasParts ? "Сохранить части" : "Сохранить график"}
            />
            {hasParts && summary.paidCount === 0 ? (
              <form action={removePaymentScheduleAction.bind(null, request.id)} style={{ marginTop: 8 }}>
                <button type="submit" className="btn btn-ghost btn-sm">
                  Объединить в один платёж
                </button>
              </form>
            ) : null}
          </details>
        ) : null}

        {canReschedule ? (
          <form action={assignRequestAccountAction.bind(null, request.id)} className="form-grid" style={{ alignItems: "flex-end", marginTop: 10 }}>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span>Счёт или касса оплаты (для прогноза по счетам)</span>
              <select name="payAccount" defaultValue={accountKey(request.payBankAccountId, request.payCashAccountId) ?? ""}>
                <PaymentAccountOptions bankAccounts={orgBankAccounts} cashAccounts={orgCashAccounts} />
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              Сохранить счёт
            </button>
          </form>
        ) : null}

        {request.reschedules.length > 0 ? (
          <>
            <h3 style={{ fontSize: 13, fontWeight: 700, margin: "14px 0 6px" }}>История переносов</h3>
            <ul className="reschedule-list">
              {request.reschedules.map((r) => (
                <li key={r.id}>
                  {r.partId ? <span className="text-muted">часть {partNumber.get(r.partId) ?? "(удалена)"}: </span> : null}
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
          </>
        ) : null}

        {canReschedule ? (
          <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
            Сроки можно двигать и в <Link href={`/payment-calendar?month=${firstDueKey.slice(0, 7)}`}>платёжном календаре</Link> — перетаскивая заявку
            или её части. Статус и согласование при этом не меняются.
          </p>
        ) : null}
      </div>

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
