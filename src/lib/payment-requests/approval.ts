import { toDecimal, type MoneyInput } from "@/lib/money";

export interface ApprovalRouteStep {
  stepOrder: number;
  roleId: string;
}

export interface ApprovalRouteCandidate {
  id: string;
  priority: number;
  minAmount: MoneyInput | null;
  maxAmount: MoneyInput | null;
  organizationId: string | null;
  steps: ApprovalRouteStep[];
}

export interface RequestForRouting {
  amount: MoneyInput;
  organizationId: string;
}

/**
 * Выбирает маршрут согласования для заявки: подходят маршруты, у которых
 * сумма заявки попадает в [minAmount, maxAmount] (null с любой стороны —
 * без ограничения) и организация либо не задана, либо совпадает. Среди
 * подходящих — наименьший priority. Null, если ни один не подошёл (тогда
 * действует старое одноступенчатое согласование).
 */
export function selectApprovalRoute(
  routes: ApprovalRouteCandidate[],
  request: RequestForRouting,
): ApprovalRouteCandidate | null {
  const amount = toDecimal(request.amount);
  const matching = routes.filter((route) => {
    if (route.organizationId && route.organizationId !== request.organizationId) return false;
    if (route.minAmount !== null && amount.lessThan(toDecimal(route.minAmount))) return false;
    if (route.maxAmount !== null && amount.greaterThan(toDecimal(route.maxAmount))) return false;
    return true;
  });
  if (matching.length === 0) return null;
  return [...matching].sort((a, b) => a.priority - b.priority)[0];
}

export function totalSteps(route: ApprovalRouteCandidate): number {
  return route.steps.length;
}

export function roleForStep(route: ApprovalRouteCandidate, stepOrder: number): string | null {
  return route.steps.find((s) => s.stepOrder === stepOrder)?.roleId ?? null;
}

export function isFinalStep(route: ApprovalRouteCandidate, stepOrder: number): boolean {
  return stepOrder >= totalSteps(route);
}
