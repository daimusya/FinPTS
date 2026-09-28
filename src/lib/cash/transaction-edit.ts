import { toDecimal } from "@/lib/money";
import { validateTransferAccounts, type AccountRef, type BankTransactionDirection } from "./transfer";

export interface TransactionEditInput {
  operationDate: Date;
  direction: BankTransactionDirection;
  amount: string;
  purpose: string | null;
  bankAccountId: string | null;
  cashAccountId: string | null;
}

/** Разбирает форму исправления операции. Сумма — строкой с двумя знаками, чтобы не терять копейки. */
export function parseTransactionEdit(get: (name: string) => unknown): TransactionEditInput | { error: string } {
  const text = (name: string) => String(get(name) ?? "").trim();
  const bankAccountId = text("bankAccountId") || null;
  const cashAccountId = text("cashAccountId") || null;
  if (Boolean(bankAccountId) === Boolean(cashAccountId)) return { error: "Выберите либо банковский счёт, либо кассу" };

  const dateRaw = text("operationDate");
  const operationDate = /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? new Date(dateRaw) : null;
  if (!operationDate || Number.isNaN(operationDate.getTime())) return { error: "Укажите дату операции" };

  const direction = text("direction");
  if (direction !== "INFLOW" && direction !== "OUTFLOW") return { error: "Укажите направление: поступление или списание" };

  const amountRaw = text("amount").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || toDecimal(amountRaw).lessThanOrEqualTo(0)) {
    return { error: "Сумма должна быть положительным числом, не больше двух знаков после запятой" };
  }

  return {
    operationDate,
    direction,
    amount: toDecimal(amountRaw).toFixed(2),
    purpose: text("purpose") || null,
    bankAccountId,
    cashAccountId,
  };
}

export interface EditableLeg {
  direction: BankTransactionDirection;
  /** Загружена из выписки (есть пакет импорта) — дата, сумма, направление и счёт как в банке. */
  isImported: boolean;
  /** Сумма действующих (не отменённых) сопоставлений с начислениями. */
  allocated: string;
  bankAccountId: string | null;
  cashAccountId: string | null;
}

/**
 * Можно ли исправить операцию так, как просят. pair — вторая нога перевода
 * между собственными счетами: у неё меняются те же дата, сумма и назначение,
 * а направление остаётся противоположным.
 */
export function checkTransactionEdit(current: EditableLeg, next: TransactionEditInput, pair: EditableLeg | null): string | null {
  if (current.isImported) {
    return "Операция загружена из выписки банка — дата, сумма и счёт должны совпадать с банком. Если выписка загружена ошибочно, удалите операцию и загрузите выписку заново";
  }
  const amount = toDecimal(next.amount);
  for (const [leg, label] of [
    [current, "этой операции"],
    [pair, "встречной операции перевода"],
  ] as const) {
    if (!leg) continue;
    const allocated = toDecimal(leg.allocated);
    if (allocated.lessThanOrEqualTo(0)) continue;
    const legDirectionChanges = leg === current ? next.direction !== current.direction : next.direction === leg.direction;
    if (legDirectionChanges) {
      return `У ${label} есть сопоставления с начислениями — сначала отмените их, потом меняйте направление`;
    }
    if (amount.lessThan(allocated)) {
      return `У ${label} сопоставлено ${allocated.toFixed(2)} — сумма не может быть меньше. Сначала отмените лишние сопоставления`;
    }
  }
  if (pair) {
    const pairAccount: AccountRef = { bankAccountId: pair.bankAccountId, cashAccountId: pair.cashAccountId };
    const error = validateTransferAccounts(pairAccount, { bankAccountId: next.bankAccountId, cashAccountId: next.cashAccountId });
    if (error) return error.replace("Второй счёт перевода должен отличаться от первого", "Счёт должен отличаться от счёта встречной операции перевода");
  }
  return null;
}

/** Удалять можно только операции без действующих сопоставлений — иначе у документов «пропадёт» оплата. */
export function checkTransactionDeletion(legs: Array<{ allocated: string }>): string | null {
  if (legs.some((leg) => toDecimal(leg.allocated).greaterThan(0))) {
    return legs.length > 1
      ? "У одной из операций перевода есть сопоставления с начислениями — сначала отмените их"
      : "У операции есть сопоставления с начислениями — сначала отмените их, чтобы оплата документов не пропала незаметно";
  }
  return null;
}
