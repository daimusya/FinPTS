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
import { postAccrualDocumentAction, cancelAccrualDocumentAction, rescheduleDocumentAction, assignDocumentAccountAction } from "../actions";
import { PaymentAccountOptions } from "@/components/payment-account-options";
import { accountKey, localDateKey, showDueDate } from "@/lib/payment-calendar";
import { PrimaryContact } from "@/components/primary-contact";
import { allocationDocumentSide, documentTotal, isForeign } from "@/lib/accruals/currency";
import { formatMoneyIn } from "@/lib/currency";
import { isVisible } from "@/lib/access-guard";
import { canPlanDocuments } from "@/lib/payment-plan/service";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";

export default async function AccrualDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const { id } = await params;
  const { error, notice } = singleParams(await searchParams);
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
      counterparty: { include: { contacts: { where: { isPrimary: true }, take: 1 } } },
      contract: true,
      responsible: true,
      lines: { include: { department: true, costCenter: true, project: true, productService: true, pnlArticle: true } },
      allocations: {
        where: { cancelledAt: null },
        include: { bankTransaction: { include: { bankAccount: true, cashAccount: true } } },
      },
      dueDateChanges: { include: { changedBy: true }, orderBy: { changedAt: "asc" } },
    },
  });
  if (!doc) notFound();
  if (!(await isVisible(session, "accrual", id))) notFound();

  const canPlan = canPlanDocuments(session) && doc.status !== "CANCELLED" && doc.paymentStatus !== "PAID" && doc.paymentStatus !== "OVERPAID";
  const [orgBankAccounts, orgCashAccounts] = canPlan
    ? await Promise.all([
        prisma.bankAccount.findMany({ where: { organizationId: doc.organizationId, isArchived: false }, orderBy: { bankName: "asc" } }),
        prisma.cashAccount.findMany({ where: { organizationId: doc.organizationId, isArchived: false }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  const todayKey = localDateKey();

  // A document in a foreign currency: totals and payments in its currency, roubles at the document rate below.
  const foreign = isForeign(doc.currency);
  const money = (value: unknown) => formatMoneyIn(Number(value), doc.currency);
  const total = documentTotal(doc.lines, foreign).toNumber();
  const allocated = doc.allocations.reduce((acc, a) => acc + allocationDocumentSide(a).toNumber(), 0);
  const totalRub = doc.lines.reduce((acc, l) => acc + Number(l.amount), 0);

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
          <p style={{ fontSize: 13 }}>
            <span className="text-muted">Контакт: </span>
            <PrimaryContact contact={doc.counterparty.contacts[0] ?? null} counterpartyId={doc.counterpartyId} />
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
                <SubmitButton className="btn btn-primary">
                  Провести
                </SubmitButton>
              </form>
            </>
          ) : null}
          {canManage && doc.status !== "CANCELLED" ? (
            <form action={cancelAccrualDocumentAction.bind(null, doc.id)}>
              <ConfirmSubmitButton className="btn btn-danger" message="Отменить документ начисления? Он перестанет учитываться в ОПиУ и расчётах с контрагентом.">
                Отменить
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
      {notice ? <p className="form-success" style={{ marginBottom: 14 }}>{notice}</p> : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Сумма документа</div>
          <div className="stat-value">{money(total)}</div>
          {foreign ? (
            <div className="text-muted" style={{ fontSize: 12 }}>
              = {formatMoney(totalRub)} по курсу {doc.exchangeRate?.toString()} на {doc.date.toLocaleDateString("ru-RU")}
            </div>
          ) : null}
        </div>
        <div className="stat-card">
          <div className="stat-label">Оплачено</div>
          <div className="stat-value">{money(allocated)}</div>
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

      {canPlan || doc.dueDateChanges.length > 0 ? (
        <div className="card" id="payment-plan">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            Срок оплаты: {doc.dueDate ? showDueDate(doc.dueDate, doc.dueTime) : "не указан"}
          </h2>
          {doc.dueDateChanges.length > 0 ? (
            <ul className="reschedule-list">
              {doc.dueDateChanges.map((c) => (
                <li key={c.id}>
                  <span className="mono">
                    {c.fromDate ? showDueDate(c.fromDate, c.fromTime) : "без срока"} → {showDueDate(c.toDate, c.toTime)}
                  </span>{" "}
                  <span className="text-muted">
                    {c.changedBy.fullName}, {c.changedAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  {c.reason ? <div className="approval-comment" style={{ marginTop: 4 }}>{c.reason}</div> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canPlan ? (
            <>
              <form action={rescheduleDocumentAction.bind(null, doc.id)} className="form-grid" style={{ alignItems: "flex-end", marginTop: 10 }}>
                <label className="field">
                  <span>Новый срок оплаты</span>
                  <input type="date" name="dueDate" min={todayKey} defaultValue={doc.dueDate?.toISOString().slice(0, 10) ?? ""} required />
                </label>
                <label className="field">
                  <span>Время</span>
                  <input type="time" name="dueTime" id="doc-due-time" defaultValue={doc.dueTime ?? ""} title="Необязательно: когда платёж должен пройти. Пусто — в течение дня" />
                </label>
                <label className="field" style={{ gridColumn: "span 2" }}>
                  <span>Причина (необязательно)</span>
                  <input type="text" name="reason" maxLength={500} placeholder="Например: заказчик просит отсрочку до конца месяца" />
                </label>
                <SubmitButton className="btn btn-secondary">
                  Перенести срок
                </SubmitButton>
              </form>
              <form action={assignDocumentAccountAction.bind(null, doc.id)} className="form-grid" style={{ alignItems: "flex-end", marginTop: 10 }}>
                <label className="field" style={{ gridColumn: "span 2" }}>
                  <span>Плановый счёт оплаты (для прогноза по счетам)</span>
                  <select name="payAccount" defaultValue={accountKey(doc.plannedBankAccountId, doc.plannedCashAccountId) ?? ""}>
                    <PaymentAccountOptions bankAccounts={orgBankAccounts} cashAccounts={orgCashAccounts} />
                  </select>
                </label>
                <SubmitButton className="btn btn-secondary">
                  Сохранить счёт
                </SubmitButton>
              </form>
              <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
                Меняется только срок оплаты — суммы и проводки документа остаются прежними, поэтому срок можно перенести и у
                проведённого документа, и в закрытом периоде. Срок можно передвинуть и в{" "}
                <Link href={`/payment-calendar?month=${(doc.dueDate ?? doc.date).toISOString().slice(0, 7)}`}>платёжном календаре</Link>.
              </p>
            </>
          ) : null}
        </div>
      ) : null}

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
                  <td className="mono">
                    {money(line.currencyAmount ?? line.amount)}
                    {foreign ? (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        {formatMoney(line.amount)}
                      </div>
                    ) : null}
                  </td>
                  <td className="mono">{(line.currencyVatAmount ?? line.vatAmount) ? money(line.currencyVatAmount ?? line.vatAmount) : "—"}</td>
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
                  <td className="mono">
                    {money(allocationDocumentSide(a))}
                    {foreign && a.transactionAmount && !a.currencyAmount?.equals(a.transactionAmount) ? (
                      <div className="text-muted" style={{ fontSize: 11 }}>
                        оплачено {formatMoney(a.transactionAmount)}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {canManage ? (
                      <form action={cancelAllocationAction.bind(null, a.id)}>
                        <ConfirmSubmitButton className="btn btn-ghost btn-sm" message="Отменить сопоставление оплаты с документом? Документ снова будет ждать оплаты.">
                          Отменить сопоставление
                        </ConfirmSubmitButton>
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
