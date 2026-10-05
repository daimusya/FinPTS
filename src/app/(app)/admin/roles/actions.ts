"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { roleChangeProblem } from "@/lib/user-admin-guard";
import { roleDeleteProblem, roleNameProblem, uniqueRoleCode } from "@/lib/roles";
import { loadAdminState } from "@/lib/user-admin-state";

export async function createRoleAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);

  const name = String(formData.get("name") ?? "").trim();
  const permissionCodes = formData.getAll("permissionCodes").map(String);

  const others = await prisma.role.findMany({ select: { name: true, code: true } });
  const nameProblem = roleNameProblem(name, others.map((r) => r.name));
  if (nameProblem) redirect(`/admin/roles/new?error=${encodeURIComponent(nameProblem)}`);

  const code = uniqueRoleCode(name, others.map((r) => r.code));
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

/** Переименовать роль (кроме системных — их названия используются в настройках по умолчанию). */
export async function renameRoleAction(roleId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);
  const back = (message: string): never => redirect(`/admin/roles/${roleId}/edit?error=${encodeURIComponent(message)}`);
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) redirect("/admin/roles");
  if (role!.isSystem) back("Системную роль переименовать нельзя — можно изменить её права");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const others = await prisma.role.findMany({ where: { id: { not: roleId } }, select: { name: true } });
  const problem = roleNameProblem(name, others.map((r) => r.name));
  if (problem) back(problem);
  if (name !== role!.name) {
    await prisma.role.update({ where: { id: roleId }, data: { name } });
    await logAudit({ userId: session.userId, entityType: "role", entityId: roleId, action: "rename", before: { name: role!.name } as never, after: { name } as never });
  }
  revalidatePath("/admin/roles");
  redirect(`/admin/roles/${roleId}/edit?notice=${encodeURIComponent("Название сохранено")}`);
}

/** Удалить ненужную роль: не системную, никому не назначенную и не используемую в маршрутах согласования. */
export async function deleteRoleAction(roleId: string) {
  const session = await requirePermission(PERMISSIONS.USERS_MANAGE);
  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: { include: { permission: true } }, _count: { select: { users: true } }, approvalSteps: { include: { route: true } } },
  });
  if (!role) redirect("/admin/roles");
  const problem = roleDeleteProblem({
    isSystem: role!.isSystem,
    userCount: role!._count.users,
    routeNames: [...new Set(role!.approvalSteps.map((s) => s.route.name))],
  });
  if (problem) redirect(`/admin/roles/${roleId}/edit?error=${encodeURIComponent(problem)}`);
  await prisma.role.delete({ where: { id: roleId } });
  await logAudit({
    userId: session.userId,
    entityType: "role",
    entityId: roleId,
    action: "delete",
    before: { name: role!.name, code: role!.code, permissionCodes: role!.permissions.map((p) => p.permission.code) } as never,
  });
  revalidatePath("/admin/roles");
  redirect(`/admin/roles?notice=${encodeURIComponent(`Роль «${role!.name}» удалена`)}`);
}
