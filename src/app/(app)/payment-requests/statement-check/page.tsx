import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { bankTransactionScopeWhere, getAccessScope, organizationScopeWhere, paymentRequestScopeWhere } from "@/lib/access-scope";
import { singleParams } from "@/lib/query-params";
import { parseDateParam } from "@/lib/date-param";
import { formatMoneyIn, normalizeCurrency } from "@/lib/currency";
import { localDateKey } from "@/lib/payment-calendar";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payment-requests/labels";
import { STATEMENT_MATCH_DAYS, canMatchStatementSlot, checkStatement, requestApprovedAt } from "@/lib/payment-requests/statement-check";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { matchStatementPartAction, unmatchStatementPartAction } from "./actions";

const DAY_MS = 24 * 60 * 60 * 1000;
const dateText = (d: Date) => d.toLocaleDateString("ru-RU", { timeZone: "UTC" });

/**
 * Сверка списаний по выписке с заявками на оплату: платежи без заявки, до
 * согласования и оплаченные по выписке, но не отмеченные в заявке.
 */
export default async function StatementCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; org?: string; error?: string; notice?: string }>;
}) {
  const session = await getSession();
  if (!session) return null;
  if (!hasPermission(session, PERMISSIONS.CASH_VIEW) && !hasPermission(session, PERMISSIONS.CASH_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав: сверка показывает банковские операции.</div>
      </div>
    );
  }
  const params = singleParams(await searchParams);
  const todayKey = localDateKey();
  const today = new Date(`${todayKey}T00:00:00.000Z`);
  const canMatch = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const to = parseDateParam(params.to) ?? today;
  const from = parseDateParam(params.from) ?? new Date(to.getTime() - 30 * DAY_MS);
  const scope = await getAccessScope(session);
  const organizations = await prisma.organization.findMany({ where: organizationScopeWhere(scope), orderBy: { name: "asc" } });
  const orgId = organizations.some((o) => o.id === params.org) ? params.org! : null;

  const transactions = await prisma.bankTransaction.findMany({
    where: {
      AND: [
        bankTransactionScopeWhere(scope),
        orgId ? { OR: [{ bankAccount: { organizationId: orgId } }, { cashAccount: { organizationId: orgId } }] } : {},
        { direction: "OUTFLOW", isTransfer: false, operationDate: { gte: from, lte: to } },
      ],
    },
    include: {
      bankAccount: { select: { organizationId: true, currency: true, bankName: true, accountNumber: true } },
      cashAccount: { select: { organizationId: true, currency: true, name: true } },
      counterparty: { select: { shortName: true, fullName: true } },
      cashFlowArticle: { select: { name: true } },
      matchedRequestPart: { select: { id: true, paymentRequestId: true } },
    },
    orderBy: { operationDate: "asc" },
  });
  // Without a counterparty (bank fees, taxes by the bank's own records) there is nothing to match against.
  const withoutPayee = transactions.filter((t) => !t.counterpartyId).length;
  const outflows = transactions
    .filter((t) => t.counterpartyId && (t.bankAccount || t.cashAccount))
    .map((t) => ({
      ...t,
      counterpartyId: t.counterpartyId!,
      organizationId: (t.bankAccount ?? t.cashAccount)!.organizationId,
      currency: normalizeCurrency((t.bankAccount ?? t.cashAccount)!.currency),
      matchedPartId: t.matchedRequestPart?.id,
    }));

  const window = STATEMENT_MATCH_DAYS * DAY_MS;
  const requestRows = outflows.length
    ? await prisma.paymentRequest.findMany({
        where: {
          AND: [
            paymentRequestScopeWhere(scope),
            {
              counterpartyId: { in: [...new Set(outflows.map((o) => o.counterpartyId))] },
              status: { not: "DRAFT" },
              OR: [
                { dueDate: { gte: new Date(from.getTime() - window), lte: new Date(to.getTime() + window) } },
                { parts: { some: { dueDate: { gte: new Date(from.getTime() - window), lte: new Date(to.getTime() + window) } } } },
              ],
            },
          ],
        },
        include: {
          parts: { select: { id: true, amount: true, dueDate: true, paidAt: true, sortOrder: true, statementTransactionId: true } },
          approvals: { where: { decision: "approved" }, select: { decision: true, round: true, decidedAt: true } },
          createdBy: { select: { fullName: true } },
        },
      })
    : [];
  const requests = requestRows.map((r) => ({
    ...r,
    approvedAt: requestApprovedAt(r.status, r.round, r.approvals),
    slots: [
      { key: "whole", amount: r.amount, dueDate: r.dueDate, paid: r.status === "PAID" },
      ...r.parts.map((p) => ({ key: p.id, amount: p.amount, dueDate: p.dueDate, paid: r.status === "PAID" || p.paidAt !== null || p.statementTransactionId !== null, statementTransactionId: p.statementTransactionId })),
    ],
  }));
  const result = checkStatement(outflows, requests, { requireUniqueRequest: true });
  const ambiguous = outflows.filter((outflow) => result.ambiguousOutflows.has(outflow.id));
  const matchedManually = outflows.filter((outflow) => outflow.matchedRequestPart && requests.some((request) => request.id === outflow.matchedRequestPart!.paymentRequestId));

  const payee = (t: (typeof outflows)[number]) => t.counterparty?.shortName || t.counterparty?.fullName || "—";
  const account = (t: (typeof outflows)[number]) =>
    t.bankAccount ? `${t.bankAccount.bankName} · ${t.bankAccount.accountNumber}` : t.cashAccount ? `касса «${t.cashAccount.name}»` : "—";
  const orgName = new Map(organizations.map((o) => [o.id, o.shortName || o.name]));
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);

  const operationCells = (t: (typeof outflows)[number]) => (
    <>
      <td className="mono">
        <Link href={`/cash/transactions/${t.id}`}>{dateText(t.operationDate)}</Link>
      </td>
      <td>{orgName.get(t.organizationId) ?? "—"}</td>
      <td>{payee(t)}</td>
      <td className="mono">{formatMoneyIn(t.amount, t.currency)}</td>
      <td className="text-muted" style={{ fontSize: 12, maxWidth: 320 }}>
        {t.purpose ?? ""}
        <div>{account(t)}{t.cashFlowArticle ? ` · ${t.cashFlowArticle.name}` : ""}</div>
      </td>
    </>
  );
  const requestCell = (r: (typeof requests)[number]) => (
    <td>
      <Link href={`/payment-requests/${r.id}`}>срок {dateText(r.dueDate)}</Link>
      <div className="text-muted" style={{ fontSize: 12 }}>
        {PAYMENT_REQUEST_STATUS_LABELS[r.status]}
        {r.approvedAt ? ` · согласована ${r.approvedAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}` : ""} · {r.createdBy.fullName}
      </div>
    </td>
  );
  const head = (extra?: string) => (
    <thead>
      <tr>
        <th>Дата списания</th>
        <th>Организация</th>
        <th>Получатель</th>
        <th>Сумма</th>
        <th>Назначение · счёт · статья</th>
        {extra ? <th>{extra}</th> : null}
      </tr>
    </thead>
  );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Сверка выписки с заявками</h1>
          <p>
            Списания по выписке сопоставляются с заявками на оплату той же организации и того же получателя на ту же сумму со сроком в
            пределах месяца. Так видно деньги, ушедшие в обход согласования.
          </p>
        </div>
        <Link href="/payment-requests" className="btn btn-secondary">
          К заявкам
        </Link>
      </div>

      <form className="card" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
        <label className="field">
          <span>С</span>
          <input type="date" name="from" id="check-from" defaultValue={isoDay(from)} />
        </label>
        <label className="field">
          <span>По</span>
          <input type="date" name="to" id="check-to" defaultValue={isoDay(to)} />
        </label>
        <label className="field">
          <span>Организация</span>
          <select name="org" id="check-org" defaultValue={orgId ?? ""}>
            <option value="">все</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.shortName || o.name}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton className="btn btn-secondary">Показать</SubmitButton>
      </form>

      {params.error ? <p className="form-error">{params.error}</p> : null}
      {params.notice ? <p className="form-success">{params.notice}</p> : null}

      <p className="text-muted" style={{ marginBottom: 16 }}>
        Списаний за период: {transactions.length}. В порядке (по согласованной и отмеченной заявке): {result.inOrder}.
        {withoutPayee > 0 ? ` Без получателя в выписке: ${withoutPayee} — комиссии и т. п., не сверяются.` : ""} Переводы между своими
        счетами не учитываются.
      </p>

      {ambiguous.length > 0 ? (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <h2>Спорные списания · {ambiguous.length}</h2>
          <table>
            {head("Часть заявки")}
            <tbody>
              {ambiguous.map((outflow) => {
                const options = requests.flatMap((request) => request.status === "APPROVED"
                  ? request.parts.filter((part) => !part.paidAt && !part.statementTransactionId && canMatchStatementSlot(outflow, request, part))
                    .map((part) => ({ request, part }))
                  : []);
                return (
                  <tr key={outflow.id}>
                    {operationCells(outflow)}
                    <td>
                      {canMatch && outflow.bankAccount && outflow.batchId && isoDay(outflow.operationDate) <= todayKey && options.length > 0 ? (
                        <form action={matchStatementPartAction}>
                          <input type="hidden" name="transactionId" value={outflow.id} />
                          <input type="hidden" name="from" value={isoDay(from)} />
                          <input type="hidden" name="to" value={isoDay(to)} />
                          <input type="hidden" name="org" value={orgId ?? ""} />
                          <select name="partId" aria-label="Часть заявки" defaultValue="" required>
                            <option value="">Выберите часть заявки</option>
                            {options.map(({ request, part }) => (
                              <option key={part.id} value={part.id}>
                                Заявка {formatMoneyIn(request.amount, request.currency)} от {dateText(request.createdAt)} · часть {part.sortOrder} · {dateText(part.dueDate)} · {request.createdBy.fullName} · {request.id.slice(-6)}
                              </option>
                            ))}
                          </select>{" "}
                          <SubmitButton className="btn btn-secondary btn-sm">Сопоставить</SubmitButton>
                        </form>
                      ) : "Требуется сверка"}
                      {options.map(({ request, part }) => (
                        <div key={part.id}><Link href={`/payment-requests/${request.id}`}>Заявка {request.id.slice(-6)} · часть {part.sortOrder}</Link></div>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {matchedManually.length > 0 ? (
        <div className="table-wrap" style={{ marginBottom: 24 }}>
          <h2>Сопоставлено вручную · {matchedManually.length}</h2>
          <table>
            {head("Заявка")}
            <tbody>
              {matchedManually.map((outflow) => (
                <tr key={outflow.id}>
                  {operationCells(outflow)}
                  <td>
                    <Link href={`/payment-requests/${outflow.matchedRequestPart!.paymentRequestId}`}>Открыть заявку</Link>
                    {canMatch ? (
                      <form action={unmatchStatementPartAction}>
                        <input type="hidden" name="transactionId" value={outflow.id} />
                        <input type="hidden" name="partId" value={outflow.matchedRequestPart!.id} />
                        <input type="hidden" name="from" value={isoDay(from)} />
                        <input type="hidden" name="to" value={isoDay(to)} />
                        <input type="hidden" name="org" value={orgId ?? ""} />
                        <ConfirmSubmitButton className="btn btn-ghost btn-sm" message="Отменить связь с частью заявки? Банковское списание останется в выписке.">
                          Отменить сопоставление
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2>Без заявки · {result.withoutRequest.length}</h2>
      <p className="text-muted">Денег ушло, а заявки на этого получателя и эту сумму нет — проверьте, кто и на каком основании платил.</p>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          {head()}
          <tbody>
            {result.withoutRequest.map((t) => (
              <tr key={t.id}>{operationCells(t)}</tr>
            ))}
            {result.withoutRequest.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  Таких списаний нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2>Оплачено до согласования · {result.beforeApproval.length}</h2>
      <p className="text-muted">Заявка есть, но на дату списания она не была согласована (или отклонена, отменена).</p>
      <div className="table-wrap" style={{ marginBottom: 24 }}>
        <table>
          {head("Заявка")}
          <tbody>
            {result.beforeApproval.map((m) => (
              <tr key={m.outflow.id}>
                {operationCells(m.outflow)}
                {requestCell(m.request)}
              </tr>
            ))}
            {result.beforeApproval.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  Таких списаний нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2>Оплачено, но не отмечено в заявке · {result.notMarked.length}</h2>
      <p className="text-muted">
        Списание найдено в выписке. Проверьте отметку об оплате в карточке заявки.
      </p>
      <div className="table-wrap">
        <table>
          {head("Заявка")}
          <tbody>
            {result.notMarked.map((m) => (
              <tr key={m.outflow.id}>
                {operationCells(m.outflow)}
                {requestCell(m.request)}
              </tr>
            ))}
            {result.notMarked.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty-state">
                  Таких списаний нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
