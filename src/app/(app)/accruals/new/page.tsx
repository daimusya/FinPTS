import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { AccrualLinesEditor } from "@/components/accrual-lines-editor";
import { createAccrualDocumentAction } from "../actions";

export default async function NewAccrualDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.ACCRUALS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для создания документов начисления.</div>
      </div>
    );
  }

  const [organizations, counterparties, contracts, users, departments, costCenters, projects, productsServices, pnlArticles] =
    await Promise.all([
      prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
      prisma.contract.findMany({ where: { isArchived: false }, orderBy: { number: "asc" } }),
      prisma.user.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" } }),
      prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.costCenter.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
      prisma.pnlArticle.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    ]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новый документ начисления</h1>
        <Link href="/accruals" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card">
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createAccrualDocumentAction}>
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
              <span>Контрагент *</span>
              <select name="counterpartyId" required>
                <option value="">— выбрать —</option>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName || c.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Договор</span>
              <select name="contractId">
                <option value="">—</option>
                {contracts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.number}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Тип документа *</span>
              <select name="documentType" required>
                <option value="INVOICE">Счёт</option>
                <option value="ACT">Акт</option>
                <option value="UPD">УПД</option>
                <option value="WAYBILL">Накладная</option>
                <option value="SALE">Реализация</option>
                <option value="RECEIPT">Поступление</option>
                <option value="RETURN">Возврат</option>
                <option value="CORRECTION">Корректировка</option>
                <option value="MANUAL">Ручное начисление</option>
              </select>
            </label>
            <label className="field">
              <span>Направление *</span>
              <select name="direction" required>
                <option value="INCOME">Доход</option>
                <option value="EXPENSE">Расход</option>
              </select>
            </label>
            <label className="field">
              <span>Номер *</span>
              <input type="text" name="number" required />
            </label>
            <label className="field">
              <span>Дата документа *</span>
              <input type="date" name="date" required />
            </label>
            <label className="field">
              <span>Срок оплаты</span>
              <input type="date" name="dueDate" />
            </label>
            <label className="field">
              <span>Ответственный</span>
              <select name="responsibleId">
                <option value="">—</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field" style={{ marginTop: 14 }}>
            <span>Комментарий</span>
            <input type="text" name="comment" />
          </label>

          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 10px" }}>Строки документа</h2>
          <AccrualLinesEditor
            options={{
              departments: departments.map((d) => ({ value: d.id, label: d.name })),
              costCenters: costCenters.map((c) => ({ value: c.id, label: c.name })),
              projects: projects.map((p) => ({ value: p.id, label: p.name })),
              productsServices: productsServices.map((p) => ({ value: p.id, label: p.name })),
              pnlArticles: pnlArticles.map((p) => ({ value: p.id, label: p.name })),
            }}
          />

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить как черновик
            </button>
            <Link href="/accruals" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
