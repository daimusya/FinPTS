"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { setFlash } from "@/lib/flash";
import crypto from "node:crypto";

export async function createUserAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const roleIds = formData.getAll("roleIds").map(String);

  if (!email || !fullName) {
    redirect(`/admin/users/new?error=${encodeURIComponent("Email и ФИО обязательны")}`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    redirect(`/admin/users/new?error=${encodeURIComponent("Пользователь с таким email уже существует")}`);
  }

  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);

  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash,
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

  if (!fullName) {
    redirect(`/admin/users/${userId}/edit?error=${encodeURIComponent("ФИО обязательно")}`);
  }

  const before = await prisma.user.findUnique({ where: { id: userId }, include: { roles: true } });

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { fullName, isActive } }),
    prisma.userRole.deleteMany({ where: { userId } }),
    prisma.userRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId })) }),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "user",
    entityId: userId,
    action: "update",
    before: before as never,
    after: { fullName, isActive, roleIds } as never,
  });

  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function resetPasswordAction(userId: string) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const tempPassword = crypto.randomBytes(9).toString("base64url");
  const passwordHash = await hashPassword(tempPassword);
  const user = await prisma.user.update({ where: { id: userId }, data: { passwordHash } });

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
