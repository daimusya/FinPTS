import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestIsHttps } from "./request-security";
import { usableSecret } from "./auth-secret";
import { PERMISSIONS, type PermissionCode } from "./permissions";
import { prisma } from "./db";
import { getUserPermissions } from "./auth";
import { sessionCutoff, sessionIssuedBeforePasswordChange } from "./password-policy";
import { mfaRequiredFor } from "./mfa/policy";
import { getMfaPolicy } from "./mfa/settings";

const COOKIE_NAME = "pts_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getSecret() {
  return new TextEncoder().encode(usableSecret());
}

export interface SessionPayload {
  userId: string;
  email: string;
  fullName: string;
  permissions: string[];
  /** Пароль выдан администратором — пользователь должен сменить его на свой. */
  mustChangePassword?: boolean;
  /** Вход с кодом обязателен для этого пользователя, а он его ещё не подключил. */
  mustSetupMfa?: boolean;
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    // By the actual protocol: over plain http (a LAN server) a Secure cookie would be silently dropped.
    secure: await requestIsHttps(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * Сессия текущего запроса. Подпись куки проверяется, а пользователь и его
 * права берутся из базы при каждом запросе (один раз за запрос): выключенный
 * («Активен» снят) или удалённый пользователь сразу теряет доступ, а смена
 * ролей действует сразу, а не через 12 часов, когда истечёт кука.
 */
export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  let payload: SessionPayload & { iat?: number };
  try {
    payload = (await jwtVerify(token, getSecret())).payload as unknown as SessionPayload & { iat?: number };
  } catch {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, fullName: true, isActive: true, mustChangePassword: true, passwordChangedAt: true, sessionsRevokedAt: true, totpEnabledAt: true },
  });
  if (!user || !user.isActive) return null;
  // A password change or reset, or an explicit end of sessions, ends every session issued before it.
  if (sessionIssuedBeforePasswordChange(payload.iat, sessionCutoff(user.passwordChangedAt, user.sessionsRevokedAt))) return null;
  const permissions = await getUserPermissions(user.id);
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    permissions,
    mustChangePassword: user.mustChangePassword,
    mustSetupMfa: !user.totpEnabledAt && mfaRequiredFor(await getMfaPolicy(), permissions),
  };
});

/**
 * Сессия для действия; если её нет (истекла, завершена, пароль сменили) —
 * на страницу входа с пояснением, а не на страницу ошибки.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await requireSessionForAccountSetup();
  // A password the administrator saw (or one that leaked on the way) opens nothing until replaced,
  // and a required sign-in code nothing until connected: not pages only (the layout), but every action and download too.
  if (session.mustChangePassword) redirect("/account/password");
  if (session.mustSetupMfa) redirect("/account/2fa");
  return session;
}

/** Сессия для настройки своего входа (смена пароля, подключение кода): и пока это ещё обязательно сделать. */
export async function requireSessionForAccountSetup(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login?expired=1");
  return session;
}

export function hasPermission(session: SessionPayload, code: PermissionCode) {
  return (
    session.permissions.includes(PERMISSIONS.ADMIN_FULL) ||
    session.permissions.includes(code)
  );
}

export async function requirePermission(
  code: PermissionCode,
): Promise<SessionPayload> {
  const session = await requireSession();
  if (!hasPermission(session, code)) {
    throw new Error("FORBIDDEN");
  }
  return session;
}
