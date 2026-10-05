"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { roleChangeProblem } from "@/lib/user-admin-guard";
import { loadAdminState } from "@/lib/user-admin-state";

function slugifyCode(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-zа-я0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "") || `role_${Date.now()}`
  );
}

export async function createRoleAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const name = String(formData.get("name") ?? "").trim();
  const permissionCodes = formData.getAll("permissionCodes").map(String);

  if (!name) {
    redirect(`/admin/roles/new?error=${encodeURIComponent("Название роли обязательно")}`);
  }

  const code = slugifyCode(name);
  const permissions = await prisma.permission.findMany({ where: { code: { in: permissionCodes } } });

  const role = await prisma.role.create({
    data: {
      code,
      name,
      isSystem: false,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "role",
    entityId: role.id,
    action: "create",
    after: { name, code, permissionCodes } as never,
  });

  revalidatePath("/admin/roles");
  redirect("/admin/roles");
}

export async function updateRolePermissionsAction(roleId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const permissionCodes = formData.getAll("permissionCodes").map(String);
  const permissions = await prisma.permission.findMany({ where: { code: { in: permissionCodes } } });

  const problem = roleChangeProblem({ roleId, codes: permissions.map((p) => p.code), ...(await loadAdminState()) });
  if (problem) redirect(`/admin/roles/${roleId}/edit?error=${encodeURIComponent(problem)}`);

  const before = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } } },
  });

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ roleId, permissionId: p.id })),
    }),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "role",
    entityId: roleId,
    action: "update_permissions",
    before: before as never,
    after: { permissionCodes } as never,
  });

  revalidatePath("/admin/roles");
  redirect("/admin/roles");
}
