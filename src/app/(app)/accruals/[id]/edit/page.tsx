import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { AccrualLinesEditor, type LineDraft } from "@/components/accrual-lines-editor";
import { updateAccrualDocumentAction } from "../../actions";

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function EditAccrualDocumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.ACCRUALS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [doc, organizations, counterparties, contracts, users, departments, costCenters, projects, productsServices, pnlArticles] =
    await Promise.all([
      prisma.accrualDocument.findUnique({ where: { id }, include: { lines: true } }),
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
  if (!doc) notFound();
  if (doc.status !== "DRAFT") {
    return (
      <div className="page">
        <div className="card">Изменять можно только документ в статусе «Черновик».</div>
      </div>
    );
  }

  const initialLines: LineDraft[] = doc.lines.map((l) => ({
    key: l.id,
    departmentId: l.departmentId ?? "",
    costCenterId: l.costCenterId ?? "",
    projectId: l.projectId ?? "",
    productServiceId: l.productServiceId ?? "",
    pnlArticleId: l.pnlArticleId ?? "",
    amount: String(l.amount),
    vatAmount: l.vatAmount ? String(l.vatAmount) : "",
    description: l.description ?? "",
  }));

  return (
    <div className="page">
      <div className="page-header">
        <h1>Изменить документ № {doc.number}</h1>
        <Link href={`/accruals/${doc.id}`} className="btn btn-secondary">
          Назад
        </Link>
      </div>

      <div className="card">
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={updateAccrualDocumentAction.bind(null, doc.id)}>
          <div className="form-grid">
            <label className="field">
              <span>Организация *</span>
              <select name="organizationId" defaultValue={doc.organizationId} required>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.shortName || o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Контрагент *</span>
              <select name="counterpartyId" defaultValue={doc.counterpartyId} required>
                {counterparties.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName || c.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Договор</span>
              <select name="contractId" defaultValue={doc.contractId ?? ""}>
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
              <select name="documentType" defaultValue={doc.documentType} required>
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
              <select name="direction" defaultValue={doc.direction} required>
                <option value="INCOME">Доход</option>
                <option value="EXPENSE">Расход</option>
              </select>
            </label>
            <label className="field">
              <span>Номер *</span>
              <input type="text" name="number" defaultValue={doc.number} required />
            </label>
            <label className="field">
              <span>Дата документа *</span>
              <input type="date" name="date" defaultValue={toDateInput(doc.date)} required />
            </label>
            <label className="field">
              <span>Срок оплаты</span>
              <input type="date" name="dueDate" defaultValue={doc.dueDate ? toDateInput(doc.dueDate) : ""} />
            </label>
            <label className="field">
              <span>Ответственный</span>
              <select name="responsibleId" defaultValue={doc.responsibleId ?? ""}>
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
            <input type="text" name="comment" defaultValue={doc.comment ?? ""} />
          </label>

          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "20px 0 10px" }}>Строки документа</h2>
          <AccrualLinesEditor
            initialLines={initialLines}
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
              Сохранить
            </button>
            <Link href={`/accruals/${doc.id}`} className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
