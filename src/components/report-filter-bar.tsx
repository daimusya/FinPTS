import { prisma } from "@/lib/db";
import type { ReactNode } from "react";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export interface ReportFilterValues {
  year: number;
  month: number;
  organizationId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectId?: string;
  productServiceId?: string;
  counterpartyId?: string;
}

export async function ReportFilterBar({
  values,
  extraQuery,
  children,
}: {
  values: ReportFilterValues;
  extraQuery?: string;
  children?: ReactNode;
}) {
  const [organizations, departments, costCenters, projects, productsServices, counterparties] = await Promise.all([
    prisma.organization.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.costCenter.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.counterparty.findMany({ where: { isArchived: false }, orderBy: { fullName: "asc" } }),
  ]);

  return (
    <form className="filter-bar">
      {extraQuery ? <input type="hidden" name="_extra" value={extraQuery} /> : null}
      <label className="field">
        <span>Год</span>
        <input type="number" name="year" defaultValue={values.year} style={{ width: 90 }} />
      </label>
      <label className="field">
        <span>Месяц</span>
        <select name="month" defaultValue={values.month}>
          {MONTH_NAMES.map((label, idx) => (
            <option key={label} value={idx + 1}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Организация</span>
        <select name="organizationId" defaultValue={values.organizationId ?? ""}>
          <option value="">Все</option>
          {organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.shortName || o.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Подразделение</span>
        <select name="departmentId" defaultValue={values.departmentId ?? ""}>
          <option value="">Все</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>ЦФО</span>
        <select name="costCenterId" defaultValue={values.costCenterId ?? ""}>
          <option value="">Все</option>
          {costCenters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Проект</span>
        <select name="projectId" defaultValue={values.projectId ?? ""}>
          <option value="">Все</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Продукт/услуга</span>
        <select name="productServiceId" defaultValue={values.productServiceId ?? ""}>
          <option value="">Все</option>
          {productsServices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Контрагент</span>
        <select name="counterpartyId" defaultValue={values.counterpartyId ?? ""}>
          <option value="">Все</option>
          {counterparties.map((c) => (
            <option key={c.id} value={c.id}>
              {c.shortName || c.fullName}
            </option>
          ))}
        </select>
      </label>
      {children}
      <button type="submit" className="btn btn-secondary">
        Применить
      </button>
    </form>
  );
}
