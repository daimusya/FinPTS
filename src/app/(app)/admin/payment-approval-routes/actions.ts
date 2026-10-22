"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";

const MAX_STEPS = 5;

function readSteps(formData: FormData): string[] {
  const steps: string[] = [];
  for (let i = 1; i <= MAX_STEPS; i += 1) {
    const roleId = String(formData.get(`stepRole${i}`) ?? "");
    if (roleId) steps.push(roleId);
  }
  return steps;
}

function readRouteForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 100) || 100;
  const minAmountRaw = String(formData.get("minAmount") ?? "").trim();
  const maxAmountRaw = String(formData.get("maxAmount") ?? "").trim();
  const organizationId = String(formData.get("organizationId") ?? "") || null;
  return {
    name,
    priority,
    minAmount: minAmountRaw || null,
    maxAmount: maxAmountRaw || null,
    organizationId,
    steps: readSteps(formData),
  };
}

export async function createRouteAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.ADMIN_FULL);
  const fields = readRouteForm(formData);

  if (!fields.name) {
    redirect(`/admin/payment-approval-routes/new?error=${encodeURIComponent("Укажите название маршрута")}`);
  }
  if (fields.steps.length === 0) {
    redirect(`/admin/payment-approval-routes/new?error=${encodeURIComponent("Добавьте хотя бы один шаг согласования")}`);
  }

  const route = await prisma.paymentApprovalRoute.create({
    data: {
      name: fields.name,
      priority: fields.priority,
      minAmount: fields.minAmount,
      maxAmount: fields.maxAmount,
      organizationId: fields.organizationId,
      steps: { create: fields.steps.map((roleId, index) => ({ stepOrder: index + 1, roleId })) },
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "payment_approval_route",
    entityId: route.id,
    action: "create",
    after: route as never,
  });

  revalidatePath("/admin/payment-approval-routes");
  redirect("/admin/payment-approval-routes");
}

export async function updateRouteAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.ADMIN_FULL);
  const fields = readRouteForm(formData);
  const isArchived = formData.get("isArchived") === "on";

  if (!fields.name) {
    redirect(`/admin/payment-approval-routes/${id}/edit?error=${encodeURIComponent("Укажите название маршрута")}`);
  }
  if (fields.steps.length === 0) {
    redirect(`/admin/payment-approval-routes/${id}/edit?error=${encodeURIComponent("Добавьте хотя бы один шаг согласования")}`);
  }

  const before = await prisma.paymentApprovalRoute.findUniqueOrThrow({ where: { id }, include: { steps: true } });
  // Requests on their way keep the steps they started with: changing them would skip or swap approvers mid-route.
  const stepsBefore = [...before.steps].sort((a, b) => a.stepOrder - b.stepOrder).map((s) => s.roleId);
  const stepsChanged = stepsBefore.length !== fields.steps.length || stepsBefore.some((roleId, i) => roleId !== fields.steps[i]);
  if (stepsChanged) {
    const onTheWay = await prisma.paymentRequest.count({ where: { routeId: id, status: "PENDING_APPROVAL" } });
    if (onTheWay > 0) {
      redirect(
        `/admin/payment-approval-routes/${id}/edit?error=${encodeURIComponent(
          `По этому маршруту сейчас на согласовании заявок: ${onTheWay} — шаги менять нельзя, иначе у них сменятся согласующие. Создайте новый маршрут с нужными шагами и отправьте этот в архив: заявки в работе дойдут по старому, новые пойдут по новому.`,
        )}`,
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.paymentApprovalRouteStep.deleteMany({ where: { routeId: id } });
    return tx.paymentApprovalRoute.update({
      where: { id },
      data: {
        name: fields.name,
        priority: fields.priority,
        minAmount: fields.minAmount,
        maxAmount: fields.maxAmount,
        organizationId: fields.organizationId,
        isArchived,
        steps: { create: fields.steps.map((roleId, index) => ({ stepOrder: index + 1, roleId })) },
      },
    });
  });

  await logAudit({
    userId: session.userId,
    entityType: "payment_approval_route",
    entityId: id,
    action: "update",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/admin/payment-approval-routes");
  redirect("/admin/payment-approval-routes");
}
