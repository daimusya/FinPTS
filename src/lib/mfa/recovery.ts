import crypto from "node:crypto";

/**
 * Резервные коды на случай, если телефон потерян: 10 кодов вида «abcd-efgh»,
 * каждый действует один раз. Хранятся только хеши (SHA-256 — коды случайные,
 * 40 бит каждый, подбирать их по хешу бессмысленно, а при входе их ещё и
 * ограничивает блокировка попыток). Чистые функции — проверяются тестами.
 */
export const RECOVERY_CODE_COUNT = 10;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from(crypto.randomBytes(8), (b) => ALPHABET[b % ALPHABET.length]).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/** Похоже ли введённое на резервный код (8 знаков из алфавита), а не на 6 цифр из приложения. */
export function looksLikeRecoveryCode(code: string): boolean {
  return /^[a-z0-9]{8}$/.test(normalizeRecoveryCode(code)) && !/^\d+$/.test(normalizeRecoveryCode(code));
}

/** Использовать резервный код: вернуть оставшиеся хеши или null, если код не подошёл. */
export function consumeRecoveryCode(hashes: readonly string[], code: string): string[] | null {
  const hash = hashRecoveryCode(code);
  const index = hashes.findIndex((h) => crypto.timingSafeEqual(Buffer.from(h, "hex"), Buffer.from(hash, "hex")));
  if (index < 0) return null;
  return hashes.filter((_, i) => i !== index);
}
