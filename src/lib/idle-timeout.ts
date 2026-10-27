import crypto from "node:crypto";

/**
 * Выход при бездействии: сеанс живёт до 12 часов, но если в системе не
 * работали дольше IDLE_MINUTES (браузер оставлен открытым на чужом или
 * общем компьютере), следующий запрос ведёт на страницу входа. Время
 * последнего действия — в куке, подписанной AUTH_SECRET и привязанной к
 * своему сеансу: подправить её вручную или взять от другого сеанса нельзя.
 * Чистые функции — проверяются тестами; применяет их src/proxy.ts.
 */
export const ACTIVITY_COOKIE = "pts_active";
export const IDLE_MINUTES = 60;
/** Чаще раза в минуту отметку не обновляем — лишние Set-Cookie ни к чему. */
const REFRESH_AFTER_MS = 60_000;

const sign = (atMs: number, sessionToken: string, secret: string) => {
  const session = crypto.createHash("sha256").update(sessionToken).digest("base64url").slice(0, 22);
  return crypto.createHmac("sha256", secret).update(`activity.${atMs}.${session}`).digest("base64url");
};

export function activityStamp(atMs: number, sessionToken: string, secret: string): string {
  return `${atMs}.${sign(atMs, sessionToken, secret)}`;
}

/** Время последнего действия из отметки или null (нет, подделана, от другого сеанса). */
export function readActivityStamp(value: string | undefined, sessionToken: string, secret: string): number | null {
  const match = /^(\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!match) return null;
  const atMs = Number(match[1]);
  const expected = Buffer.from(sign(atMs, sessionToken, secret));
  const given = Buffer.from(match[2]);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? atMs : null;
}

/**
 * expired — бездействие дольше предела (или отметки нет: сеанс выдан до
 * появления проверки); refresh — обновить отметку; fresh — ничего не делать.
 */
export function idleVerdict(lastActivityMs: number | null, nowMs: number, idleMinutes = IDLE_MINUTES): "expired" | "refresh" | "fresh" {
  if (lastActivityMs === null) return "expired";
  // A stamp from the future is not from this server's clock: no "eternal activity".
  const idleMs = Math.max(0, nowMs - lastActivityMs);
  if (idleMs > idleMinutes * 60_000 || lastActivityMs - nowMs > REFRESH_AFTER_MS) return "expired";
  return idleMs >= REFRESH_AFTER_MS ? "refresh" : "fresh";
}
