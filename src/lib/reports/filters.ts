export interface ReportFilters {
  organizationId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectId?: string;
  productServiceId?: string;
  counterpartyId?: string;
}

export interface ReportSearchParams {
  year?: string;
  month?: string;
  organizationId?: string;
  departmentId?: string;
  costCenterId?: string;
  projectId?: string;
  productServiceId?: string;
  counterpartyId?: string;
}

export function extractFilters(sp: ReportSearchParams): ReportFilters {
  return {
    organizationId: sp.organizationId || undefined,
    departmentId: sp.departmentId || undefined,
    costCenterId: sp.costCenterId || undefined,
    projectId: sp.projectId || undefined,
    productServiceId: sp.productServiceId || undefined,
    counterpartyId: sp.counterpartyId || undefined,
  };
}
