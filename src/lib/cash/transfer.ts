export type BankTransactionDirection = "INFLOW" | "OUTFLOW";

/** Вторая нога перевода всегда движется в противоположном направлении относительно первой. */
export function oppositeDirection(direction: BankTransactionDirection): BankTransactionDirection {
  return direction === "INFLOW" ? "OUTFLOW" : "INFLOW";
}

export interface AccountRef {
  bankAccountId: string | null;
  cashAccountId: string | null;
}

/**
 * Проверка счетов перевода между собственными счетами (раздел «Банк и
 * касса» README): ровно один счёт-получатель/отправитель, и он должен
 * отличаться от счёта первой ноги — иначе перевод «сам себе» задвоил бы
 * остаток вместо того, чтобы оставить его без изменений.
 */
export function validateTransferAccounts(primary: AccountRef, second: AccountRef): string | null {
  const secondCount = Number(Boolean(second.bankAccountId)) + Number(Boolean(second.cashAccountId));
  if (secondCount !== 1) {
    return "Для перевода между собственными счетами выберите второй счёт или кассу (ровно один)";
  }
  const primaryId = primary.bankAccountId ?? primary.cashAccountId;
  const secondId = second.bankAccountId ?? second.cashAccountId;
  if (primaryId && secondId && primaryId === secondId) {
    return "Второй счёт перевода должен отличаться от первого";
  }
  return null;
}
