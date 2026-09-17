import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createBankTransactionAction } from "../../actions";

export default async function NewCashTransactionPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.CASH_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [bankAccounts, cashAccounts, counterparties, cashFlowArticles, departments, costCenters, projects, productsServices] =
    await Promise.all([
      prisma.bankAccount.findMany({ where: { isArchived: false }, orderBy: { bankName: "asc" } }),
      prisma.cashAccount.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
      prisma.cashFlowArticle.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.costCenter.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    ]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новая операция (вручную)</h1>
        <Link href="/cash/transactions" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createBankTransactionAction}>
          <div className="form-grid">
            <label className="field">
              <span>Банковский счёт</span>
              <select name="bankAccountId">
                <option value="">—</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bankName} · {a.accountNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Касса</span>
              <select name="cashAccountId">
                <option value="">—</option>
                {cashAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дата операции *</span>
              <input type="date" name="operationDate" required />
            </label>
            <label className="field">
              <span>Направление *</span>
              <select name="direction" required>
                <option value="INFLOW">Поступление</option>
                <option value="OUTFLOW">Списание</option>
              </select>
            </label>
            <label className="field">
              <span>Сумма *</span>
              <input type="number" step="0.01" name="amount" required />
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
              <span>Подразделение</span>
              <select name="departmentId">
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>ЦФО</span>
              <select name="costCenterId">
                <option value="">—</option>
                {costCenters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Проект</span>
              <select name="projectId">
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Продукт/услуга</span>
              <select name="productServiceId">
                <option value="">—</option>
                {productsServices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field" style={{ marginTop: 14 }}>
            <span>Назначение платежа</span>
            <input type="text" name="purpose" />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" name="isTransfer" />
            Перевод между собственными счетами
          </label>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить
            </button>
            <Link href="/cash/transactions" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
