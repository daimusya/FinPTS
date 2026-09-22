import { prisma } from "./db";
import { PERMISSIONS } from "./permissions";
import type { SessionPayload } from "./session";
import type { Prisma } from "@prisma/client";

export interface AccessScope {
  /** null = не ограничено (видит всё), массив (в т.ч. пустой) = только эти ID. */
  organizationIds: string[] | null;
  departmentIds: string[] | null;
  projectIds: string[] | null;
}

export const UNRESTRICTED_SCOPE: AccessScope = {
  organizationIds: null,
  departmentIds: null,
  projectIds: null,
};

/**
 * Ограничение видимости по организациям/подразделениям/проектам (раздел 4
 * ТЗ). Работает по принципу «явное назначение — ограничение»: пока
 * администратор не назначил пользователю ни одной строки доступа в
 * конкретном разрезе (организации/подразделения/проекты), этот разрез
 * остаётся неограниченным — так включение функции не блокирует всех
 * существующих пользователей по умолчанию. Полный администратор
 * (`admin.full`) всегда видит всё, минуя назначения.
 */
export async function getAccessScope(session: SessionPayload): Promise<AccessScope> {
  if (session.permissions.includes(PERMISSIONS.ADMIN_FULL)) {
    return UNRESTRICTED_SCOPE;
  }

  const [orgAccess, deptAccess, projAccess] = await Promise.all([
    prisma.userOrganizationAccess.findMany({ where: { userId: session.userId }, select: { organizationId: true } }),
    prisma.userDepartmentAccess.findMany({ where: { userId: session.userId }, select: { departmentId: true } }),
    prisma.userProjectAccess.findMany({ where: { userId: session.userId }, select: { projectId: true } }),
  ]);

  return buildScope(
    orgAccess.map((a) => a.organizationId),
    deptAccess.map((a) => a.departmentId),
    projAccess.map((a) => a.projectId),
  );
}

/** Чистая часть getAccessScope, вынесена отдельно ради юнит-теста без БД. */
export function buildScope(organizationIds: string[], departmentIds: string[], projectIds: string[]): AccessScope {
  return {
    organizationIds: organizationIds.length > 0 ? organizationIds : null,
    departmentIds: departmentIds.length > 0 ? departmentIds : null,
    projectIds: projectIds.length > 0 ? projectIds : null,
  };
}

export function isScopeRestricted(scope: AccessScope): boolean {
  return scope.organizationIds !== null || scope.departmentIds !== null || scope.projectIds !== null;
}

/** where-условие по организации для сущностей с полем organizationId (документы начисления, расчёты ЗП, сотрудники). */
export function organizationIdScopeWhere(scope: AccessScope): { organizationId: { in: string[] } } | Record<string, never> {
  return scope.organizationIds ? { organizationId: { in: scope.organizationIds } } : {};
}

export function accrualScopeWhere(scope: AccessScope): Prisma.AccrualDocumentWhereInput {
  return organizationIdScopeWhere(scope);
}

export function payrollRunScopeWhere(scope: AccessScope): Prisma.PayrollRunWhereInput {
  return organizationIdScopeWhere(scope);
}

export function employeeScopeWhere(scope: AccessScope): Prisma.EmployeeWhereInput {
  const and: Prisma.EmployeeWhereInput[] = [];
  if (scope.organizationIds) and.push({ organizationId: { in: scope.organizationIds } });
  if (scope.departmentIds) and.push({ departmentId: { in: scope.departmentIds } });
  return and.length > 0 ? { AND: and } : {};
}

/** Банковские/кассовые операции хранят organizationId только через счёт/кассу, поэтому организация — через OR. */
export function bankTransactionScopeWhere(scope: AccessScope): Prisma.BankTransactionWhereInput {
  const and: Prisma.BankTransactionWhereInput[] = [];
  if (scope.organizationIds) {
    and.push({
      OR: [
        { bankAccount: { organizationId: { in: scope.organizationIds } } },
        { cashAccount: { organizationId: { in: scope.organizationIds } } },
      ],
    });
  }
  if (scope.departmentIds) and.push({ departmentId: { in: scope.departmentIds } });
  if (scope.projectIds) and.push({ projectId: { in: scope.projectIds } });
  return and.length > 0 ? { AND: and } : {};
}

export function organizationScopeWhere(scope: AccessScope): Prisma.OrganizationWhereInput {
  return scope.organizationIds ? { id: { in: scope.organizationIds } } : {};
}

export function departmentScopeWhere(scope: AccessScope): Prisma.DepartmentWhereInput {
  const and: Prisma.DepartmentWhereInput[] = [];
  if (scope.organizationIds) and.push({ organizationId: { in: scope.organizationIds } });
  if (scope.departmentIds) and.push({ id: { in: scope.departmentIds } });
  return and.length > 0 ? { AND: and } : {};
}

export function projectScopeWhere(scope: AccessScope): Prisma.ProjectWhereInput {
  const and: Prisma.ProjectWhereInput[] = [];
  if (scope.organizationIds) and.push({ organizationId: { in: scope.organizationIds } });
  if (scope.projectIds) and.push({ id: { in: scope.projectIds } });
  return and.length > 0 ? { AND: and } : {};
}

export function paymentRequestScopeWhere(scope: AccessScope): Prisma.PaymentRequestWhereInput {
  return organizationIdScopeWhere(scope);
}
