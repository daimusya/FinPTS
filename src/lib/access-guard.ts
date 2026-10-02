import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/session";
import {
  accrualScopeWhere,
  bankTransactionScopeWhere,
  employeeScopeWhere,
  getAccessScope,
  isScopeRestricted,
  paymentRequestScopeWhere,
  payrollRunScopeWhere,
} from "@/lib/access-scope";

/**
 * Проверка видимости отдельной записи — та же, что у списков и отчётов
 * (src/lib/access-scope.ts), но для страниц записи и действий с ней: без неё
 * пользователь с доступом к одной организации мог бы открыть или изменить
 * чужую запись по прямой ссылке. Полный администратор видит всё.
 */
export type GuardedKind = "accrual" | "request" | "transaction" | "employee" | "payrollRun";

export const NOT_VISIBLE = "Запись не найдена или недоступна вам";

export async function isVisible(session: SessionPayload, kind: GuardedKind, id: string): Promise<boolean> {
  const scope = await getAccessScope(session);
  if (!isScopeRestricted(scope)) return true;
  switch (kind) {
    case "accrual":
      return (await prisma.accrualDocument.count({ where: { id, ...accrualScopeWhere(scope) } })) > 0;
    case "request":
      return (await prisma.paymentRequest.count({ where: { id, ...paymentRequestScopeWhere(scope) } })) > 0;
    case "transaction":
      return (await prisma.bankTransaction.count({ where: { id, ...bankTransactionScopeWhere(scope) } })) > 0;
    case "employee":
      return (await prisma.employee.count({ where: { id, ...employeeScopeWhere(scope) } })) > 0;
    case "payrollRun":
      return (await prisma.payrollRun.count({ where: { id, ...payrollRunScopeWhere(scope) } })) > 0;
  }
}

/** Можно ли пользователю заводить записи этой организации (создание документа, заявки, расчёта, сотрудника). */
export async function organizationAllowed(session: SessionPayload, organizationId: string): Promise<boolean> {
  const scope = await getAccessScope(session);
  return !scope.organizationIds || scope.organizationIds.includes(organizationId);
}

export const ORGANIZATION_NOT_ALLOWED = "У вас нет доступа к этой организации — выберите организацию из своих";
