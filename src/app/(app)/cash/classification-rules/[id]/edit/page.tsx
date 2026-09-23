import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { updateRuleAction } from "../../actions";

export default async function EditClassificationRulePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const { error } = await searchParams;
  if (!session || !hasPermission(session, PERMISSIONS.CASH_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const [rule, cashFlowArticles, departments, costCenters, projects, productsServices] = await Promise.all([
    prisma.bankClassificationRule.findUnique({ where: { id } }),
    prisma.cashFlowArticle.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.costCenter.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);
  if (!rule) notFound();

  return (
    <div className="page">
      <div className="page-header">
        <h1>Правило: {rule.name}</h1>
        <Link href="/cash/classification-rules" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={updateRuleAction.bind(null, id)}>
          <div className="form-grid">
            <label className="field">
              <span>Название *</span>
              <input type="text" name="name" defaultValue={rule.name} required />
            </label>
            <label className="field">
              <span>Приоритет (меньше — раньше)</span>
              <input type="number" name="priority" defaultValue={rule.priority} />
            </label>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" name="isArchived" defaultChecked={rule.isArchived} />
            В архиве (не применяется)
          </label>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>
            Условия (нужно хотя бы одно из трёх ниже)
          </h2>
          <div className="form-grid">
            <label className="field">
              <span>Направление</span>
              <select name="direction" defaultValue={rule.direction ?? ""}>
                <option value="">Любое</option>
                <option value="INFLOW">Поступление</option>
                <option value="OUTFLOW">Списание</option>
              </select>
            </label>
            <label className="field">
              <span>Назначение платежа содержит</span>
              <input type="text" name="purposeContains" defaultValue={rule.purposeContains ?? ""} placeholder="например, аренда" />
            </label>
            <label className="field">
              <span>ИНН контрагента</span>
              <input type="text" name="counterpartyInn" defaultValue={rule.counterpartyInn ?? ""} />
            </label>
            <label className="field">
              <span>Сумма равна</span>
              <input type="number" step="0.01" name="amountEquals" defaultValue={rule.amountEquals?.toString() ?? ""} />
            </label>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Что назначить при совпадении</h2>
          <div className="form-grid">
            <label className="field">
              <span>Статья ДДС *</span>
              <select name="cashFlowArticleId" defaultValue={rule.cashFlowArticleId ?? ""} required>
                <option value="">— выбрать —</option>
                {cashFlowArticles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Подразделение</span>
              <select name="departmentId" defaultValue={rule.departmentId ?? ""}>
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
              <select name="costCenterId" defaultValue={rule.costCenterId ?? ""}>
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
              <select name="projectId" defaultValue={rule.projectId ?? ""}>
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
              <select name="productServiceId" defaultValue={rule.productServiceId ?? ""}>
                <option value="">—</option>
                {productsServices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить
            </button>
            <Link href="/cash/classification-rules" className="btn btn-secondary">
              Отмена
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
