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
  returnPaymentRequestAction,
  resubmitPaymentRequestAction,
  reschedulePaymentRequestAction,
  savePaymentScheduleAction,
  removePaymentScheduleAction,
  markPaymentPartPaidAction,
  assignRequestAccountAction,
} from "../actions";
import { accountKey, localDateKey, requestPlacement, showDueDate } from "@/lib/payment-calendar";
import { scheduleSummary, suggestSplit } from "@/lib/payment-requests/parts";
import { canPlanRequests } from "@/lib/payment-plan/service";
import { PaymentScheduleEditor } from "@/components/payment-schedule-editor";
import { PaymentAccountOptions } from "@/components/payment-account-options";
import { currentDeciders } from "@/lib/payment-requests/notify";

const STATE_LABELS: Record<TimelineState, string> = {
  approved: "Согласовано",
  rejected: "Отклонено",
  returned: "Возвращено на доработку",
  current: "Ждёт решения",
  waiting: "Впереди",
  not_reached: "Не понадобилось",
};

const STATE_BADGE: Record<TimelineState, string> = {
  approved: "badge-active",
  rejected: "badge-danger",
  returned: "badge-warning",
  current: "badge-warning",
  waiting: "badge-archived",
  not_reached: "badge-archived",
};

/** Due dates are stored as UTC midnight: show them without shifting by the time zone. */

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
      approvals: { include: { approver: true, onBehalfOf: true }, orderBy: { decidedAt: "asc" } },
      reschedules: { include: { changedBy: true }, orderBy: { changedAt: "asc" } },
      parts: { include: { paidBy: true, payBankAccount: true, payCashAccount: true }, orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }] },
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
  const pending = request.status === "PENDING_APPROVAL";
  // Members of the step's role (or holders of the approve permission) and their deputies for today.
  const deciders = pending ? await currentDeciders(request.id) : [];
  const myAuthority = deciders.find((d) => d.userId === session.userId && d.onBehalfOfId === null) ?? deciders.find((d) => d.userId === session.userId);
  const canDecide = pending && (isAdmin || Boolean(myAuthority) || (!request.route && canApprove));
  const onBehalfOfName =
    myAuthority?.onBehalfOfId && !isAdmin ? (await prisma.user.findUnique({ where: { id: myAuthority.onBehalfOfId } }))?.fullName ?? null : null;

  // The step timeline shows the current round; earlier rounds are in the full history below.
  const recorded = request.approvals.map((a) => ({
    stepOrder: a.stepOrder,
    decision: a.decision,
    approverName: a.approver.fullName,
    decidedAt: a.decidedAt,
    comment: a.comment,
    onBehalfOfName: a.onBehalfOf?.fullName ?? null,
    round: a.round,
  }));
  const timeline = buildApprovalTimeline({
    steps: steps.map((s) => ({ stepOrder: s.stepOrder, roleName: s.role.name })),
    decisions: recorded.filter((d) => d.round === request.round),
    currentStep: request.currentStep,
    status: request.status,
  });
  const reworkable = request.status === "RETURNED" || request.status === "REJECTED";
  const canRework = reworkable && (request.createdById === session.userId || isAdmin);
  const lastVerdict = [...recorded].reverse().find((d) => d.decision === "returned" || d.decision === "rejected");
  const [reworkCounterparties, reworkArticles] = canRework
    ? await Promise.all([
        prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
        prisma.cashFlowArticle.findMany({ where: { isArchived: false, direction: "OUTFLOW" }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  const decisionVerb = (d: { decision: string }) =>
    d.decision === "rejected" ? "Отклонил" : d.decision === "returned" ? "Вернул на доработку" : d.decision === "resubmitted" ? "Отправил заново" : "Согласовал";

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
            {counterpartyName} · срок оплаты {showDueDate(request.dueDate, request.dueTime)}{" "}
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

      {reworkable && lastVerdict ? (
        <div className="card" style={{ borderColor: "var(--color-warning)" }}>
          <p>
            <strong>{request.status === "RETURNED" ? "Возвращена на доработку" : "Отклонена"}</strong> — {lastVerdict.approverName}
            {lastVerdict.onBehalfOfName ? ` (за ${lastVerdict.onBehalfOfName})` : ""}, {dateTime(lastVerdict.decidedAt)}
          </p>
          {lastVerdict.comment ? <blockquote className="approval-comment">{lastVerdict.comment}</blockquote> : null}
          {canRework ? (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Исправьте заявку в блоке «Доработка» ниже и отправьте её на согласование заново — отдельную заявку создавать не нужно.
            </p>
          ) : null}
        </div>
      ) : null}

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
          <dd>{showDueDate(request.dueDate, request.dueTime)}</dd>
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
          План оплаты: {hasParts ? `частями, ${summary.total} ч.` : `одним платежом ${showDueDate(request.dueDate, request.dueTime)}`}
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
                      {showDueDate(part.dueDate, part.dueTime)}
                      {part.payBankAccount || part.payCashAccount ? (
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          счёт:{" "}
                          {part.payBankAccount
                            ? `${part.payBankAccount.bankName} · ${part.payBankAccount.accountNumber}`
                            : `касса «${part.payCashAccount!.name}»`}
                        </div>
                      ) : null}
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
            <label className="field">
              <span>Время</span>
              <input type="time" name="dueTime" id="pr-move-time" defaultValue={request.dueTime ?? ""} title="Необязательно: когда платёж должен пройти (например, до отсечки банка). Пусто — в течение дня" />
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
                  ? unpaidParts.map((part) => ({
                      id: part.id,
                      dueDate: part.dueDate.toISOString().slice(0, 10),
                      dueTime: part.dueTime ?? "",
                      amount: part.amount.toFixed(2),
                    }))
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
                    {showDueDate(r.fromDate, r.fromTime)} → {showDueDate(r.toDate, r.toTime)}
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
                    {decisionVerb(d)}: {d.approverName}
                    {d.onBehalfOfName ? ` (за ${d.onBehalfOfName})` : ""}, {dateTime(d.decidedAt)}
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
        {request.round > 1 ? (
          <details style={{ marginTop: 12 }}>
            <summary>Все решения по заявке — кругов согласования: {request.round}</summary>
            <ul className="reschedule-list" style={{ marginTop: 8 }}>
              {recorded.map((d, i) => (
                <li key={i}>
                  <span className="text-muted">
                    круг {d.round}
                    {d.stepOrder ? `, шаг ${d.stepOrder}` : ""}:
                  </span>{" "}
                  {decisionVerb(d)} — {d.approverName}
                  {d.onBehalfOfName ? ` (за ${d.onBehalfOfName})` : ""}, <span className="text-muted">{dateTime(d.decidedAt)}</span>
                  {d.comment ? <div className="approval-comment" style={{ marginTop: 4 }}>{d.comment}</div> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {canRework ? (
        <div className="card" id="rework">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Доработка</h2>
          <form action={resubmitPaymentRequestAction.bind(null, request.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
            <label className="field">
              <span>Контрагент</span>
              <select name="counterpartyId" id="rework-counterparty" defaultValue={request.counterpartyId ?? ""}>
                <option value="">—</option>
                {reworkCounterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName || c.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Статья ДДС</span>
              <select name="cashFlowArticleId" id="rework-article" defaultValue={request.cashFlowArticleId ?? ""}>
                <option value="">—</option>
                {reworkArticles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Сумма, ₽ *</span>
              <input type="text" inputMode="decimal" name="amount" id="rework-amount" required defaultValue={request.amount.toFixed(2)} style={{ width: 140 }} />
            </label>
            <label className="field">
              <span>Срок оплаты *</span>
              <input type="date" name="dueDate" id="rework-due" required defaultValue={firstDueKey} />
            </label>
            <label className="field">
              <span>Время оплаты</span>
              <input type="time" name="dueTime" id="rework-due-time" defaultValue={request.dueTime ?? ""} title="Необязательно: когда платёж должен пройти (например, до отсечки банка). Пусто — в течение дня" />
            </label>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span>Комментарий к заявке</span>
              <textarea name="comment" id="rework-comment" rows={2} defaultValue={request.comment ?? ""} />
            </label>
            <label className="field" style={{ gridColumn: "span 2" }}>
              <span>Что исправлено (увидят согласующие)</span>
              <textarea name="resubmitNote" id="rework-note" rows={2} maxLength={1000} />
            </label>
            <button type="submit" className="btn btn-primary">
              Отправить на согласование заново
            </button>
          </form>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Согласование начнётся с первого шага, маршрут подберётся под новую сумму. Если сумма изменится, график оплаты
            частями удалится — его нужно будет задать заново.
          </p>
        </div>
      ) : null}

      {canDecide ? (
        <div className="card" id="decision">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            Ваше решение{request.route ? ` — шаг ${request.currentStep}` : ""}
            {onBehalfOfName ? ` (вы замещаете: ${onBehalfOfName})` : ""}
          </h2>
          <form action={approvePaymentRequestAction.bind(null, request.id)}>
            <input type="hidden" name="expectedStep" value={request.currentStep} />
            <input type="hidden" name="returnTo" value="detail" />
            <label className="field">
              <span>Комментарий (при отклонении и возврате на доработку обязателен)</span>
              <textarea name="comment" rows={3} maxLength={DECISION_COMMENT_MAX_LENGTH} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Согласовать
              </button>
              <button type="submit" className="btn btn-secondary" formAction={returnPaymentRequestAction.bind(null, request.id)}>
                Вернуть на доработку
              </button>
              <button type="submit" className="btn btn-danger" formAction={rejectPaymentRequestAction.bind(null, request.id)}>
                Отклонить
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {(canPay && request.status === "APPROVED") || (canApprove && (pending || request.status === "APPROVED" || request.status === "RETURNED")) ? (
        <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canPay && request.status === "APPROVED" ? (
            <form action={markPaymentRequestPaidAction.bind(null, request.id)}>
              <input type="hidden" name="returnTo" value="detail" />
              <button type="submit" className="btn btn-secondary">
                Отметить оплаченной
              </button>
            </form>
          ) : null}
          {canApprove && (pending || request.status === "APPROVED" || request.status === "RETURNED") ? (
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
