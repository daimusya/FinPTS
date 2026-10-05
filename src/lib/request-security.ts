import { headers } from "next/headers";

/**
 * Открыта ли страница по HTTPS — от этого зависит пометка кук «только по
 * HTTPS» (Secure). Раньше она зависела от режима сборки: в рабочем режиме за
 * обычным http (сервер в локальной сети, docker-compose на :3000) браузер
 * молча не сохранял куку сессии, и вход просто возвращал на страницу входа.
 * COOKIE_SECURE=always|never задаёт поведение явно (например, за прокси,
 * который не передаёт X-Forwarded-Proto).
 */
export function isHttpsRequest(input: { setting?: string; forwardedProto?: string | null; origin?: string | null; referer?: string | null }): boolean {
  if (input.setting === "always") return true;
  if (input.setting === "never") return false;
  const proto = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  return [input.origin, input.referer].some((url) => Boolean(url && url.toLowerCase().startsWith("https://")));
}

export async function requestIsHttps(): Promise<boolean> {
  const h = await headers();
  return isHttpsRequest({
    setting: process.env.COOKIE_SECURE,
    forwardedProto: h.get("x-forwarded-proto"),
    origin: h.get("origin"),
    referer: h.get("referer"),
  });
}

/** Вход по незащищённому соединению не с этой машины — пароль идёт открытым текстом. */
export function insecureRemoteLogin(input: { https: boolean; host: string | null }): boolean {
  if (input.https) return false;
  const host = (input.host ?? "").toLowerCase().replace(/:\d+$/, "");
  return !["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) && !host.endsWith(".localhost");
}
