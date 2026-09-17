import crypto from "node:crypto";

export interface FingerprintInput {
  bankAccountId: string;
  operationDate: Date;
  direction: "INFLOW" | "OUTFLOW";
  amount: string;
  purpose?: string | null;
  externalRef?: string | null;
}

/**
 * Стабильный отпечаток строки выписки для защиты от повторной загрузки.
 * Если в файле есть номер операции банка (externalRef), он однозначно
 * определяет строку. Иначе используется композитный ключ по счёту, дате,
 * направлению, сумме и назначению платежа — это может по ошибке признать
 * дублем две разные операции с абсолютно одинаковыми счётом/датой/суммой/
 * назначением в один день. Известное ограничение, см. README.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const parts = input.externalRef
    ? [input.bankAccountId, "ref", input.externalRef]
    : [
        input.bankAccountId,
        input.operationDate.toISOString().slice(0, 10),
        input.direction,
        input.amount,
        (input.purpose ?? "").trim().toLowerCase(),
      ];
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex");
}
