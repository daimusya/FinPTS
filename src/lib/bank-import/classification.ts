import { toDecimal, type MoneyInput } from "@/lib/money";

export type Direction = "INFLOW" | "OUTFLOW";

export interface ClassificationRuleInput {
  id: string;
  priority: number;
  direction: Direction | null;
  purposeContains: string | null;
  counterpartyInn: string | null;
  amountEquals: MoneyInput | null;
  cashFlowArticleId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  productServiceId: string | null;
}

export interface ClassifiableTransaction {
  direction: Direction;
  purpose: string | null;
  counterpartyInn: string | null;
  amount: MoneyInput;
}

export interface ClassificationResult {
  ruleId: string;
  cashFlowArticleId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  productServiceId: string | null;
}

/** Правило без единого условия (кроме направления) не должно уметь совпасть — иначе оно молча классифицировало бы вообще всё. */
export function hasAnyCondition(rule: Pick<ClassificationRuleInput, "purposeContains" | "counterpartyInn" | "amountEquals">): boolean {
  return Boolean(rule.purposeContains) || Boolean(rule.counterpartyInn) || rule.amountEquals !== null;
}

export function ruleMatches(rule: ClassificationRuleInput, tx: ClassifiableTransaction): boolean {
  if (!hasAnyCondition(rule)) return false;
  if (rule.direction && rule.direction !== tx.direction) return false;
  if (rule.purposeContains) {
    if (!tx.purpose || !tx.purpose.toLowerCase().includes(rule.purposeContains.toLowerCase())) return false;
  }
  if (rule.counterpartyInn) {
    if (tx.counterpartyInn !== rule.counterpartyInn) return false;
  }
  if (rule.amountEquals !== null) {
    if (!toDecimal(tx.amount).equals(toDecimal(rule.amountEquals))) return false;
  }
  return true;
}

/** Первое совпавшее правило по возрастанию priority побеждает. */
export function classifyTransaction(rules: ClassificationRuleInput[], tx: ClassifiableTransaction): ClassificationResult | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (ruleMatches(rule, tx)) {
      return {
        ruleId: rule.id,
        cashFlowArticleId: rule.cashFlowArticleId,
        departmentId: rule.departmentId,
        costCenterId: rule.costCenterId,
        projectId: rule.projectId,
        productServiceId: rule.productServiceId,
      };
    }
  }
  return null;
}
