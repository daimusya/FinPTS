import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { isForeignCurrencyEnabled } from "@/lib/foreign-currency";
import { createPaymentRequestAction } from "../actions";
import { getAccessScope, organizationIdScopeWhere, organizationScopeWhere } from "@/lib/access-scope";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";

export default async function NewPaymentRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = singleParams(await searchParams);
  if (!session || !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_CREATE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [organizations, counterparties, cashFlowArticles, bankAccounts, cashAccounts] = await Promise.all([
    prisma.organization.findMany({ where: { isArchived: false, ...organizationScopeWhere(await getAccessScope(session)) }, orderBy: { name: "asc" } }),
    prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
    prisma.cashFlowArticle.findMany({ where: { isArchived: false, direction: "OUTFLOW" }, orderBy: { name: "asc" } }),
    prisma.bankAccount.findMany({ where: { isArchived: false, ...organizationIdScopeWhere(await getAccessScope(session)) }, include: { organization: true }, orderBy: { bankName: "asc" } }),
    prisma.cashAccount.findMany({ where: { isArchived: false, ...organizationIdScopeWhere(await getAccessScope(session)) }, include: { organization: true }, orderBy: { name: "asc" } }),
  ]);
  const orgName = (o: { name: string; shortName: string | null }) => o.shortName || o.name;

  const foreignCurrency = await isForeignCurrencyEnabled();
  return (
    <div className="page">
      <div className="page-header">
        <h1>Новая заявка на оплату</h1>
        <Link href="/payment-requests" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createPaymentRequestAction}>
          <div className="form-grid">
            <label className="field">
              <span>Организация *</span>
              <select name="organizationId" required>
                <option value="">— выбрать —</option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName || o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Контрагент</span>
              <select name="counterpartyId">
                <option value="">—</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName || c.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Статья ДДС</span>
              <select name="cashFlowArticleId">
                <option value="">—</option>
                {cashFlowArticles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Сумма *</span>
              <input type="number" step="0.01" name="amount" required />
            </label>
            {foreignCurrency ? (
              <label className="field">
                <span>Валюта</span>
                <select name="currency" id="pr-currency" defaultValue={"RUB"}>
                  {CURRENCY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="field">
              <span>Срок оплаты *</span>
              <input type="date" name="dueDate" required />
            </label>
            <label className="field">
              <span>Время оплаты</span>
              <input type="time" name="dueTime" id="pr-due-time" title="Необязательно: когда платёж должен пройти (например, до отсечки банка). Пусто — в течение дня" />
            </label>
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Счёт или касса оплаты (необязательно, для прогноза по счетам)</span>
              <select name="payAccount" defaultValue="">
                <option value="">— не назначен —</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={`bank:${a.id}`}>
                    {orgName(a.organization)}: {a.bankName} · {a.accountNumber}
                  </option>
                ))}
                {cashAccounts.map((a) => (
                  <option key={a.id} value={`cash:${a.id}`}>
                    {orgName(a.organization)}: касса «{a.name}»
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field" style={{ marginTop: 14 }}>
            <span>Комментарий</span>
            <input type="text" name="comment" />
          </label>
          <div className="form-actions">
            <SubmitButton className="btn btn-primary">
              Отправить на согласование
            </SubmitButton>
            <Link href="/payment-requests" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
