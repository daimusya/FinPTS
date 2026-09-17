import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createPaymentRequestAction } from "../actions";

export default async function NewPaymentRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_CREATE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [organizations, counterparties, cashFlowArticles] = await Promise.all([
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
    prisma.cashFlowArticle.findMany({ where: { isArchived: false, direction: "OUTFLOW" }, orderBy: { name: "asc" } }),
  ]);

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
            <label className="field">
              <span>Срок оплаты *</span>
              <input type="date" name="dueDate" required />
            </label>
          </div>
          <label className="field" style={{ marginTop: 14 }}>
            <span>Комментарий</span>
            <input type="text" name="comment" />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Отправить на согласование
            </button>
            <Link href="/payment-requests" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
