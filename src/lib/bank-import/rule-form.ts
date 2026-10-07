import { validateInn } from "@/lib/integrations/inn";
import { parseFormAmount } from "@/lib/form-values";

/**
 * Проверка условий правила разнесения. Плохое правило массово портит
 * разнесение: сумма «abc» роняла сохранение, ИНН с опечаткой молча не
 * срабатывает никогда, а одна буква в назначении совпадает почти с любой
 * операцией. Чистая функция — проверяется тестами.
 */
export const MIN_PURPOSE_LENGTH = 3;

export function ruleConditionsProblem(input: {
  direction: string | null;
  purposeContains: string | null;
  counterpartyInn: string | null;
  amountEquals: string | null;
}): { error: string } | { amountEquals: string | null; counterpartyInn: string | null } {
  if (input.direction && input.direction !== "INFLOW" && input.direction !== "OUTFLOW") return { error: "Выберите направление из списка" };
  if (input.purposeContains && input.purposeContains.trim().length < MIN_PURPOSE_LENGTH) {
    return { error: `Текст в назначении — не короче ${MIN_PURPOSE_LENGTH} символов, иначе правило совпадёт почти с любой операцией` };
  }
  let inn: string | null = null;
  if (input.counterpartyInn) {
    inn = input.counterpartyInn.replace(/\s/g, "");
    const problem = validateInn(inn);
    if (problem) return { error: `ИНН контрагента: ${problem}` };
  }
  let amount: string | null = null;
  if (input.amountEquals) {
    const parsed = parseFormAmount(input.amountEquals, "Сумма");
    if ("error" in parsed) return { error: parsed.error };
    amount = parsed.value;
  }
  return { amountEquals: amount, counterpartyInn: inn };
}
