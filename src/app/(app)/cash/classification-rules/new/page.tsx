import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { createRuleAction } from "../actions";

export default async function NewClassificationRulePage({
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

  const [cashFlowArticles, departments, costCenters, projects, productsServices] = await Promise.all([
    prisma.cashFlowArticle.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.costCenter.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Новое правило классификации</h1>
        <Link href="/cash/classification-rules" className="btn btn-secondary">
          Назад к списку
        </Link>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}
        <form action={createRuleAction}>
          <div className="form-grid">
            <label className="field">
              <span>Название *</span>
              <input type="text" name="name" required />
            </label>
            <label className="field">
              <span>Приоритет (меньше — раньше)</span>
              <input type="number" name="priority" defaultValue={100} />
            </label>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>
            Условия (нужно хотя бы одно из трёх ниже)
          </h2>
          <div className="form-grid">
            <label className="field">
              <span>Направление</span>
              <select name="direction">
                <option value="">Любое</option>
                <option value="INFLOW">Поступление</option>
                <option value="OUTFLOW">Списание</option>
              </select>
            </label>
            <label className="field">
              <span>Назначение платежа содержит</span>
              <input type="text" name="purposeContains" placeholder="например, аренда" />
            </label>
            <label className="field">
              <span>ИНН контрагента</span>
              <input type="text" name="counterpartyInn" />
            </label>
            <label className="field">
              <span>Сумма равна</span>
              <input type="number" step="0.01" name="amountEquals" />
            </label>
          </div>

          <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Что назначить при совпадении</h2>
          <div className="form-grid">
            <label className="field">
              <span>Статья ДДС *</span>
              <select name="cashFlowArticleId" required>
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

          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Создать
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
