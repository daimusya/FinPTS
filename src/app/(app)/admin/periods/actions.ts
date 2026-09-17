"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { PeriodStatus } from "@prisma/client";

export async function createPeriodAction(formData: FormData) {
  await requirePermission(PERMISSIONS.PERIODS_MANAGE);

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!year || !month || month < 1 || month > 12) {
    redirect(`/admin/periods?error=${encodeURIComponent("Некорректные год/месяц")}`);
  }

  await prisma.accountingPeriod.upsert({
    where: { year_month: { year, month } },
    update: {},
    create: { year, month, status: PeriodStatus.OPEN },
  });

  revalidatePath("/admin/periods");
}

export async function closePeriodAction(periodId: string) {
  const session = await requirePermission(PERMISSIONS.PERIODS_MANAGE);

  const before = await prisma.accountingPeriod.findUnique({ where: { id: periodId } });
  const updated = await prisma.accountingPeriod.update({
    where: { id: periodId },
    data: { status: PeriodStatus.CLOSED, closedById: session.userId, closedAt: new Date() },
  });

  await logAudit({
    userId: session.userId,
    entityType: "accounting_period",
    entityId: periodId,
    action: "close_period",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/admin/periods");
}

export async function reopenPeriodAction(periodId: string) {
  const session = await requirePermission(PERMISSIONS.PERIODS_REOPEN);

  const before = await prisma.accountingPeriod.findUnique({ where: { id: periodId } });
  const updated = await prisma.accountingPeriod.update({
    where: { id: periodId },
    data: { status: PeriodStatus.OPEN, reopenedById: session.userId, reopenedAt: new Date() },
  });

  await logAudit({
    userId: session.userId,
    entityType: "accounting_period",
    entityId: periodId,
    action: "reopen_period",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/admin/periods");
}
