import { cache } from "react";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { requestIsHttps } from "./request-security";
import { PERMISSIONS, type PermissionCode } from "./permissions";
import { prisma } from "./db";
import { getUserPermissions } from "./auth";
import { sessionCutoff, sessionIssuedBeforePasswordChange } from "./password-policy";

const COOKIE_NAME = "pts_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET не задан в окружении");
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  userId: string;
  email: string;
  fullName: string;
  permissions: string[];
  /** Пароль выдан администратором — пользователь должен сменить его на свой. */
  mustChangePassword?: boolean;
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
    select: { id: true, email: true, fullName: true, isActive: true, mustChangePassword: true, passwordChangedAt: true, sessionsRevokedAt: true },
  });
  if (!user || !user.isActive) return null;
  // A password change or reset, or an explicit end of sessions, ends every session issued before it.
  if (sessionIssuedBeforePasswordChange(payload.iat, sessionCutoff(user.passwordChangedAt, user.sessionsRevokedAt))) return null;
  return {
    userId: user.id,
    email: user.email,
    fullName: user.fullName,
    permissions: await getUserPermissions(user.id),
    mustChangePassword: user.mustChangePassword,
  };
});

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
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
