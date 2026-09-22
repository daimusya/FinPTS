import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET не задан в окружении");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

/**
 * Шифрует значение (например, вебхук с токеном доступа) для хранения в
 * config-полях интеграций. Использует AES-256-GCM с ключом, производным
 * от AUTH_SECRET — отдельного KMS в этой версии нет, но значение больше
 * не лежит в базе открытым текстом.
 */
export function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Маска для отображения в форме без раскрытия значения целиком. */
export function maskSecret(plainText: string): string {
  if (plainText.length <= 8) return "••••••••";
  return `${plainText.slice(0, 8)}••••••••${plainText.slice(-4)}`;
}
