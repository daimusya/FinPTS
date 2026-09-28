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

export type ApprovalDecision = "approved" | "rejected";

export const DECISION_COMMENT_MAX_LENGTH = 1000;

/**
 * Комментарий согласующего: необязателен при согласовании, обязателен при
 * отклонении — автор заявки должен понимать, что исправить.
 */
export function parseDecisionComment(decision: ApprovalDecision, raw: unknown): { comment: string | null } | { error: string } {
  const comment = String(raw ?? "").trim().replace(/\r\n/g, "\n");
  if (decision === "rejected" && !comment) return { error: "Укажите причину отклонения — автор заявки увидит её в истории согласования" };
  if (comment.length > DECISION_COMMENT_MAX_LENGTH) {
    return { error: `Комментарий длиннее ${DECISION_COMMENT_MAX_LENGTH} символов — сократите его` };
  }
  return { comment: comment || null };
}

export interface RecordedDecision {
  stepOrder: number | null;
  decision: string;
  approverName: string;
  decidedAt: Date;
  comment: string | null;
}

export type TimelineState = "approved" | "rejected" | "current" | "waiting" | "not_reached";

export interface TimelineEntry {
  /** Null — одноступенчатое согласование заявки без маршрута. */
  stepOrder: number | null;
  roleName: string | null;
  state: TimelineState;
  /** Решения по шагу в порядке времени (обычно одно). */
  decisions: RecordedDecision[];
  /** Решение принято по шагу, которого в маршруте уже нет (маршрут правили после). */
  removedFromRoute: boolean;
}

/**
 * История согласования по шагам: для каждого шага маршрута — чьё решение,
 * когда и с каким комментарием, или что шаг текущий / ещё впереди / не
 * понадобился (заявку отклонили или отменили раньше).
 */
export function buildApprovalTimeline(input: {
  steps: Array<{ stepOrder: number; roleName: string }>;
  decisions: RecordedDecision[];
  currentStep: number;
  status: string;
}): TimelineEntry[] {
  const pending = input.status === "PENDING_APPROVAL";
  const byTime = [...input.decisions].sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime());
  const stateOf = (decisions: RecordedDecision[], isCurrent: boolean, isAhead: boolean): TimelineState => {
    const last = decisions.at(-1);
    if (last) return last.decision === "rejected" ? "rejected" : "approved";
    if (pending && isCurrent) return "current";
    if (pending && isAhead) return "waiting";
    return "not_reached";
  };

  if (input.steps.length === 0) {
    const decisions = byTime.filter((d) => d.stepOrder === null);
    return [{ stepOrder: null, roleName: null, state: stateOf(decisions, true, false), decisions, removedFromRoute: false }];
  }

  const entries: TimelineEntry[] = [...input.steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((step) => {
      const decisions = byTime.filter((d) => d.stepOrder === step.stepOrder);
      return {
        stepOrder: step.stepOrder,
        roleName: step.roleName,
        state: stateOf(decisions, step.stepOrder === input.currentStep, step.stepOrder > input.currentStep),
        decisions,
        removedFromRoute: false,
      };
    });

  const known = new Set(input.steps.map((s) => s.stepOrder));
  const orphanSteps = [...new Set(byTime.filter((d) => d.stepOrder !== null && !known.has(d.stepOrder)).map((d) => d.stepOrder!))];
  for (const stepOrder of orphanSteps) {
    const decisions = byTime.filter((d) => d.stepOrder === stepOrder);
    entries.push({ stepOrder, roleName: null, state: stateOf(decisions, false, false), decisions, removedFromRoute: true });
  }
  return entries.sort((a, b) => (a.stepOrder ?? 0) - (b.stepOrder ?? 0));
}
