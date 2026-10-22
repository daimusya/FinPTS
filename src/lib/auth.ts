import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { PERMISSIONS } from "./permissions";

const SALT_ROUNDS = 12;
/** Хеш случайной строки: проверка пароля для несуществующего адреса идёт столько же, сколько для настоящего. */
const DUMMY_HASH = "$2b$12$bRpm1313TRzvqAHh8v9lK.gJHKutix6svcI2nEbVkxhfPB4EW9mrK";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function getUserPermissions(userId: string): Promise<string[]> {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });

  const codes = new Set<string>();
  for (const userRole of roles) {
    for (const rp of userRole.role.permissions) {
      codes.add(rp.permission.code);
    }
  }
  return Array.from(codes);
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  permissions: string[];
}

export async function authenticate(
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    // The same time as a real check: the answer's speed must not tell which addresses have an account.
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;

  const permissions = await getUserPermissions(user.id);
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    permissions,
  };
}

export function isSystemAdmin(permissions: string[]): boolean {
  return permissions.includes(PERMISSIONS.ADMIN_FULL);
}
