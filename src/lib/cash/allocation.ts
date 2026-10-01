import Decimal from "decimal.js";
import { toDecimal, type MoneyInput } from "@/lib/money";
import { formatMoneyIn } from "@/lib/currency";

/**
 * Проверка сопоставления оплаты с документом на сервере (форма предлагает
 * только подходящие документы, но запрос можно отправить и в обход формы):
 * — поступление гасит документ дохода, списание — документ расхода;
 * — документ проведён и не отменён;
 * — перевод между своими счетами — не оплата;
 * — сумма не больше несопоставленного остатка операции (в её валюте):
 *   нельзя «оплатить» больше, чем пришло или ушло. Переплата документа
 *   допустима — у него будет статус «переплачен».
 */
export function checkAllocation(input: {
  transactionDirection: "INFLOW" | "OUTFLOW";
  isTransfer: boolean;
  documentDirection: "INCOME" | "EXPENSE";
  documentStatus: string;
  entered: MoneyInput;
  transactionAmount: MoneyInput;
  alreadyAllocated: MoneyInput;
  /** Валюта счёта операции — для суммы в сообщении. */
  currency?: string;
}): string | null {
  if (input.isTransfer) return "Перевод между собственными счетами — не оплата, сопоставлять его с документами нельзя";
  if (input.documentStatus !== "POSTED") return "Сопоставлять оплату можно только с проведённым документом";
  const expected = input.transactionDirection === "INFLOW" ? "INCOME" : "EXPENSE";
  if (input.documentDirection !== expected) {
    return input.transactionDirection === "INFLOW"
      ? "Поступление гасит только документ дохода, а выбран документ расхода"
      : "Списание гасит только документ расхода, а выбран документ дохода";
  }
  const remaining = toDecimal(input.transactionAmount).minus(toDecimal(input.alreadyAllocated));
  const entered = toDecimal(input.entered);
  if (entered.greaterThan(remaining)) {
    return `Сумма больше несопоставленного остатка операции (${formatMoneyIn(remaining.toDecimalPlaces(2, Decimal.ROUND_HALF_UP), input.currency ?? "RUB")}) — нельзя сопоставить больше, чем прошло по счёту`;
  }
  return null;
}
