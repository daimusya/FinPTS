import { reencryptSecret } from "@/lib/crypto/secret-box";

/**
 * Перешифровать все зашифрованные значения в настройках интеграции: по
 * соглашению их поля оканчиваются на «Enc» (webhookUrlEnc, apiKeyEnc,
 * smtp.passwordEnc, telegram.tokenEnc), на любой глубине. Возвращает новый
 * объект и число перешифрованных значений. Чистая функция — проверяется тестами.
 */
export function rekeyConfig(value: unknown, fromSecret: string, toSecret: string): { value: unknown; count: number } {
  if (Array.isArray(value)) {
    let count = 0;
    const items = value.map((item) => {
      const r = rekeyConfig(item, fromSecret, toSecret);
      count += r.count;
      return r.value;
    });
    return { value: items, count };
  }
  if (value && typeof value === "object") {
    let count = 0;
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.endsWith("Enc") && typeof item === "string" && item) {
        out[key] = reencryptSecret(item, fromSecret, toSecret);
        count++;
      } else {
        const r = rekeyConfig(item, fromSecret, toSecret);
        out[key] = r.value;
        count += r.count;
      }
    }
    return { value: out, count };
  }
  return { value, count: 0 };
}
