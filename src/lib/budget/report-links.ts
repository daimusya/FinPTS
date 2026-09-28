import type { ReportFilters } from "@/lib/reports/filters";

/** Разрез фильтра отчёта в адресе редактора бюджета — ссылка «Бюджет» открывает план того же разреза. */
export function budgetDim(filters: ReportFilters): string {
  if (filters.departmentId) return `&dim=dep:${filters.departmentId}`;
  if (filters.costCenterId) return `&dim=cc:${filters.costCenterId}`;
  if (filters.projectId) return `&dim=prj:${filters.projectId}`;
  return "";
}

/** С каким планом сравнивается отчёт — пояснение под таблицей. */
export function planSliceNote(filters: ReportFilters): string {
  const dim = filters.departmentId ? "выбранного подразделения" : filters.costCenterId ? "выбранного ЦФО" : filters.projectId ? "выбранного проекта" : null;
  if (dim) return ` ${dim}${filters.organizationId ? " (по компании в целом и выбранной организации)" : ""}`;
  return filters.organizationId ? " по выбранной организации" : " (все уровни плана: компания, организации, разрезы)";
}
