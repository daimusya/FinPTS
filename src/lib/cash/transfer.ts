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

/**
 * Суммы двух ног перевода. Счета в одной валюте — одна сумма на обеих ногах
 * (вторую указывать не нужно; указанная другая — ошибка: комиссия банка —
 * отдельная операция). Счета в разных валютах (покупка или продажа валюты) —
 * сумма второй ноги обязательна, в валюте второго счёта; курс сделки — для
 * сообщения.
 */
export function resolveTransferAmounts(input: {
  amount: string;
  secondAmount: string;
  currency: string;
  secondCurrency: string;
}): { first: string; second: string; dealRate: string | null } | { error: string } {
  const parse = (raw: string) => {
    const text = raw.replace(/\s/g, "").replace(",", ".");
    return /^\d+(\.\d{1,2})?$/.test(text) && Number(text) > 0 ? Number(text).toFixed(2) : null;
  };
  const first = parse(input.amount);
  if (!first) return { error: "Сумма — положительное число, не больше двух знаков после запятой" };
  const secondText = input.secondAmount.trim();
  if (input.currency === input.secondCurrency) {
    if (secondText && parse(secondText) !== first) {
      return { error: "У счетов одна валюта — суммы перевода должны совпадать. Комиссию банка внесите отдельной операцией" };
    }
    return { first, second: first, dealRate: null };
  }
  const second = parse(secondText);
  if (!second) {
    return { error: `Счета в разных валютах (${input.currency} и ${input.secondCurrency}) — укажите сумму, поступившую на второй счёт, в ${input.secondCurrency}` };
  }
  // Roubles per unit of the foreign currency, whichever side it is on.
  const rate = input.currency === "RUB" ? Number(first) / Number(second) : input.secondCurrency === "RUB" ? Number(second) / Number(first) : Number(second) / Number(first);
  return { first, second, dealRate: rate.toFixed(4) };
}
