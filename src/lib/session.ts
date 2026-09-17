import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { PERMISSIONS, type PermissionCode } from "./permissions";

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
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

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
