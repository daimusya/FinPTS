import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { usableSecret } from "@/lib/auth-secret";
import { requestIsHttps } from "@/lib/request-security";
import { sessionCutoff, sessionIssuedBeforePasswordChange } from "@/lib/password-policy";

/**
 * Вход в два шага: пароль верный, но сеанс ещё не выдан — браузер получает
 * короткий (5 минут) подписанный пропуск на страницу ввода кода. Пропуск
 * годится только для неё (свой «purpose» и свой путь куки), а сменённый тем
 * временем пароль или завершённые сеансы его отменяют.
 */
const COOKIE_NAME = "pts_mfa";
const TTL_SECONDS = 5 * 60;
const PURPOSE = "mfa-login";

const secret = () => new TextEncoder().encode(usableSecret());

export async function startPendingLogin(userId: string): Promise<void> {
  const token = await new SignJWT({ userId, purpose: PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: await requestIsHttps(),
    sameSite: "lax",
    path: "/login",
    maxAge: TTL_SECONDS,
  });
}

/** Пользователь, прошедший первый шаг, или null (пропуска нет, он истёк или отменён). */
export async function readPendingLogin() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  let payload: { userId?: string; purpose?: string; iat?: number };
  try {
    payload = (await jwtVerify(token, secret())).payload as typeof payload;
  } catch {
    return null;
  }
  if (payload.purpose !== PURPOSE || !payload.userId) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.isActive || !user.totpEnabledAt || !user.totpSecretEnc) return null;
  if (sessionIssuedBeforePasswordChange(payload.iat, sessionCutoff(user.passwordChangedAt, user.sessionsRevokedAt))) return null;
  return user;
}

export async function clearPendingLogin(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { httpOnly: true, path: "/login", maxAge: 0 });
}
