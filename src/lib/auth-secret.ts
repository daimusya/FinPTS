/**
 * Проверка AUTH_SECRET — ключа подписи сеансов и шифрования секретов
 * интеграций. Секрет из примера (.env.example) или слишком короткий позволяет
 * подделать сеанс любого пользователя, включая администратора. Чистые
 * функции — проверяются тестами.
 */
export const EXAMPLE_SECRET = "replace-with-a-long-random-string";
export const MIN_SECRET_LENGTH = 32;
const HARD_MIN_LENGTH = 16;

export type SecretWeakness = "missing" | "example" | "too_short" | "short" | "simple";

export function secretWeakness(secret: string | undefined): SecretWeakness | null {
  if (!secret) return "missing";
  if (secret.trim() === EXAMPLE_SECRET || /replace-with|changeme|change-me|^secret$/i.test(secret.trim())) return "example";
  if (secret.length < HARD_MIN_LENGTH) return "too_short";
  if (secret.length < MIN_SECRET_LENGTH) return "short";
  if (new Set(secret).size < 10) return "simple";
  return null;
}

/** Слабости, при которых работать нельзя вовсе (сеанс подделывается тривиально). */
export function isUnusableSecret(weakness: SecretWeakness | null): boolean {
  return weakness === "missing" || weakness === "example" || weakness === "too_short";
}

export const SECRET_ADVICE =
  "Задайте в .env AUTH_SECRET — случайную строку не короче 32 символов (например, openssl rand -base64 48) и перезапустите приложение. " +
  "Все войдут заново; ключи интеграций (DaData, банки, почта, Telegram, Битрикс24) нужно будет ввести ещё раз — они зашифрованы прежним секретом.";

export function secretProblemText(weakness: SecretWeakness): string {
  switch (weakness) {
    case "missing":
      return "AUTH_SECRET не задан";
    case "example":
      return "AUTH_SECRET — заготовка (из примера или со словами вроде «change-me»): по нему можно подделать вход любого пользователя";
    case "too_short":
      return `AUTH_SECRET короче ${HARD_MIN_LENGTH} символов — его легко подобрать`;
    case "short":
      return `AUTH_SECRET короче ${MIN_SECRET_LENGTH} символов`;
    case "simple":
      return "AUTH_SECRET слишком однообразный (мало разных символов)";
  }
}

/**
 * Секрет для подписи и шифрования. В рабочем режиме явно непригодный —
 * ошибка с подсказкой, что делать; при разработке — работает, а мониторинг
 * показывает проблему (не запирать разработчика с заготовкой в .env).
 */
export function usableSecret(): string {
  const secret = process.env.AUTH_SECRET;
  const weakness = secretWeakness(secret);
  if (weakness === "missing" || (process.env.NODE_ENV === "production" && isUnusableSecret(weakness))) {
    throw new Error(`${secretProblemText(weakness!)}. ${SECRET_ADVICE}`);
  }
  return secret!;
}
