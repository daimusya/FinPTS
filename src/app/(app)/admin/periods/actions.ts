"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { MAX_YEAR, MIN_YEAR } from "@/lib/form-values";
import { PeriodStatus } from "@prisma/client";
import { runPeriodCloseChecklist } from "@/lib/period-close/checklist";
import { computeClosingSnapshot } from "@/lib/period-close/snapshot";

export async function createPeriodAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PERIODS_MANAGE);

  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    redirect(`/admin/periods?error=${encodeURIComponent("Выберите месяц")}`);
  }
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) {
    redirect(`/admin/periods?error=${encodeURIComponent(`Год — от ${MIN_YEAR} до ${MAX_YEAR}`)}`);
  }
  const label = `${String(month).padStart(2, "0")}.${year}`;

  const existing = await prisma.accountingPeriod.findUnique({ where: { year_month: { year, month } } });
  if (existing) redirect(`/admin/periods?notice=${encodeURIComponent(`Период ${label} уже есть`)}`);

  const created = await prisma.accountingPeriod.create({ data: { year, month, status: PeriodStatus.OPEN } });
  await logAudit({ userId: session.userId, entityType: "accounting_period", entityId: created.id, action: "create", after: created as never });

  revalidatePath("/admin/periods");
  redirect(`/admin/periods?notice=${encodeURIComponent(`Период ${label} создан`)}`);
}

export async function closePeriodAction(periodId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PERIODS_MANAGE);

  const before = await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const results = await runPeriodCloseChecklist(before.year, before.month);

  const hasCritical = results.some((r) => r.severity === "critical" && !r.passed);
  const hasWarning = results.some((r) => r.severity === "warning" && !r.passed);
  const acknowledged = formData.get("acknowledgeWarnings") === "on";

  await prisma.$transaction([
    prisma.periodCloseCheck.deleteMany({ where: { periodId } }),
    prisma.periodCloseCheck.createMany({
      data: results.map((r) => ({
        periodId,
        checkType: r.checkType,
        severity: r.severity,
        passed: r.passed,
        message: r.message,
      })),
    }),
  ]);

  if (hasCritical) {
    redirect(
      `/admin/periods/${periodId}/close?error=${encodeURIComponent(
        "Есть критические ошибки контрольного листа — закрытие периода заблокировано.",
      )}`,
    );
  }
  if (hasWarning && !acknowledged) {
    redirect(
      `/admin/periods/${periodId}/close?error=${encodeURIComponent(
        "Есть предупреждения контрольного листа — подтвердите осознанное закрытие галочкой ниже.",
      )}`,
    );
  }

  const snapshot = await computeClosingSnapshot(before.year, before.month);

  const updated = await prisma.accountingPeriod.update({
    where: { id: periodId },
    data: {
      status: PeriodStatus.CLOSED,
      closedById: session.userId,
      closedAt: new Date(),
      closingSnapshot: snapshot as never,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "accounting_period",
    entityId: periodId,
    action: "close_period",
    before: before as never,
    after: { ...updated, checklist: results } as never,
  });

  revalidatePath("/admin/periods");
  redirect("/admin/periods");
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
