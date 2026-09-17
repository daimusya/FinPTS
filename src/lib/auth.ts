import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { PERMISSIONS } from "./permissions";

const SALT_ROUNDS = 12;

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
  if (!user || !user.isActive) return null;

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
