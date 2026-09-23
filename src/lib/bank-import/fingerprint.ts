import crypto from "node:crypto";

export interface FingerprintInput {
  bankAccountId: string;
  operationDate: Date;
  direction: "INFLOW" | "OUTFLOW";
  amount: string;
  purpose?: string | null;
  externalRef?: string | null;
}

function fingerprintKey(input: FingerprintInput): string {
  const parts = input.externalRef
    ? [input.bankAccountId, "ref", input.externalRef]
    : [
        input.bankAccountId,
        input.operationDate.toISOString().slice(0, 10),
        input.direction,
        input.amount,
        (input.purpose ?? "").trim().toLowerCase(),
      ];
  return parts.join("|");
}

const hash = (key: string) => crypto.createHash("sha256").update(key).digest("hex");

/**
 * Стабильный отпечаток одной операции для защиты от повторного ввода.
 * Если есть номер операции банка (externalRef), он однозначно определяет
 * строку. Иначе — композитный ключ по счёту, дате, направлению, сумме и
 * назначению платежа. Для строк выписки используйте
 * computeStatementFingerprints — она различает одинаковые операции.
 */
export function computeFingerprint(input: FingerprintInput): string {
  return hash(fingerprintKey(input));
}

/**
 * Отпечатки всех строк одной выписки. Без номера операции банка две
 * разные операции могут совпасть по всем полям (например, две одинаковые
 * комиссии за день), поэтому одинаковые строки нумеруются в порядке
 * появления в файле: первая получает обычный отпечаток (тот же, что у
 * computeFingerprint — совместимо с уже загруженными и введёнными вручную
 * операциями), вторая — с суффиксом «#2» и т.д. Повторная загрузка того же
 * файла или выписки, перекрывающей его целыми днями, даёт те же номера, и
 * дубли по-прежнему отсекаются. Строки с номером операции банка не
 * нумеруются: один номер дважды — это одна и та же операция.
 */
export function computeStatementFingerprints(rows: FingerprintInput[]): Array<{ fingerprint: string; occurrence: number }> {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = fingerprintKey(row);
    if (row.externalRef) return { fingerprint: hash(key), occurrence: 1 };
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    return { fingerprint: hash(occurrence === 1 ? key : `${key}|#${occurrence}`), occurrence };
  });
}
