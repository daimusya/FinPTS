"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { setFlash } from "@/lib/flash";
import { userChangeProblem } from "@/lib/user-admin-guard";
import { loadAdminState } from "@/lib/user-admin-state";
import { normalizeUserEmail } from "@/lib/user-email";
import { isUniqueViolation } from "@/lib/dictionaries/errors";

const EMAIL_TAKEN = "Пользователь с таким email уже существует";
import crypto from "node:crypto";

export async function createUserAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const parsedEmail = normalizeUserEmail(formData.get("email"));
  const fullName = String(formData.get("fullName") ?? "").trim();
  const roleIds = formData.getAll("roleIds").map(String);

  if ("error" in parsedEmail) redirect(`/admin/users/new?error=${encodeURIComponent(parsedEmail.error)}`);
  const { email } = parsedEmail as { email: string };
  if (!fullName) {
    redirect(`/admin/users/new?error=${encodeURIComponent("ФИО обязательно")}`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirect(`/admin/users/new?error=${encodeURIComponent(EMAIL_TAKEN)}`);
  }

  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash,
      // The administrator saw this password: the user replaces it at the first sign-in.
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      roles: { create: roleIds.map((roleId) => ({ roleId })) },
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "user",
    entityId: user.id,
    action: "create",
    after: { email, fullName, roleIds } as never,
  });

  await setFlash("tempPassword", `${email}\n${tempPassword}`);
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function updateUserAction(userId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const fullName = String(formData.get("fullName") ?? "").trim();
  const isActive = formData.get("isActive") === "on";
  const roleIds = formData.getAll("roleIds").map(String);
  // The e-mail is the login: an administrator corrects a mistyped or changed address.
  const parsedEmail = normalizeUserEmail(formData.get("email"));

  if (!fullName) {
    redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent("ФИО обязательно")}`);
  }
  if ("error" in parsedEmail) redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent(parsedEmail.error)}`);
  const { email } = parsedEmail as { email: string };
  if (await prisma.user.findFirst({ where: { email, id: { not: userId } } })) {
    redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent(EMAIL_TAKEN)}`);
  }

  const problem = userChangeProblem({ actorId: session.userId, targetId: userId, change: { isActive, roleIds }, ...(await loadAdminState()) });
  if (problem) redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent(problem)}`);

  const before = await prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });

  try {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { fullName, email, isActive } }),
      prisma.userRole.deleteMany({ where: { userId } }),
      prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId })) }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent(EMAIL_TAKEN)}`);
    throw error;
  }

  await logAudit({
    userId: session.userId,
    entityType: "user",
    entityId: userId,
    action: "update",
    before: before as never,
    after: { fullName, email, isActive, roleIds } as never,
  });

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function updateUserAccessScopeAction(userId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const organizationIds = formData.getAll("organizationIds").map(String);
  const departmentIds = formData.getAll("departmentIds").map(String);
  const projectIds = formData.getAll("projectIds").map(String);

  await prisma.$transaction([
    prisma.userOrganizationAccess.deleteMany({ where: { userId } }),
    prisma.userOrganizationAccess.createMany({ data: organizationIds.map((organizationId) => ({ userId, organizationId })) }),
    prisma.userDepartmentAccess.deleteMany({ where: { userId } }),
    prisma.userDepartmentAccess.createMany({ data: departmentIds.map((departmentId) => ({ userId, departmentId })) }),
    prisma.userProjectAccess.deleteMany({ where: { userId } }),
    prisma.userProjectAccess.createMany({ data: projectIds.map((projectId) => ({ userId, projectId })) }),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "user_access_scope",
    entityId: userId,
    action: "update",
    after: { organizationIds, departmentIds, projectIds } as never,
  });

  revalidatePath(`/admin/users/${userId}/edit`);
  redirect(`/admin/users/${userId}/edit`);
}

export async function resetPasswordAction(userId: string) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);
  // An own password is changed knowing the current one, not reset to a temporary one.
  if (userId === session.userId) redirect("/account/password");

  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);
  // A reset ends the user's current sessions and asks for an own password at the next sign-in.
  const user = await prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() } });

  await logAudit({
    userId: session.userId,
    entityType: "user",
    entityId: userId,
    action: "reset_password",
  });

  await setFlash("tempPassword", `${user.email}\n${tempPassword}`);
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

/** Завершить все сеансы пользователя (потерянное устройство, подозрение на чужой вход) — пароль не меняется. */
export async function endUserSessionsAction(userId: string) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);
  // One's own sessions are ended on the password page, keeping the current one.
  if (userId === session.userId) redirect("/account/password");
  const user = await prisma.user.update({ where: { id: userId }, data: { sessionsRevokedAt: new Date() } });
  await logAudit({ userId: session.userId, entityType: "user", entityId: userId, action: "end_sessions" });
  revalidatePath("/admin/users");
  redirect(`/admin/users?notice=${encodeURIComponent(`Сеансы пользователя ${user.fullName} завершены — ему нужно войти заново`)}`);
}
