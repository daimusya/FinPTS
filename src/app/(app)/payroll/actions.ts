"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate, getOrCreatePeriod } from "@/lib/period";
import { PERMISSIONS } from "@/lib/permissions";
import { calculatePayrollRun, computeTaxes, loadTaxRates } from "@/lib/payroll/calculate";
import { toDecimal } from "@/lib/money";
import { PayrollRunStatus } from "@prisma/client";

export async function createPayrollRunAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const organizationId = String(formData.get("organizationId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const payoutDateRaw = String(formData.get("payoutDate") ?? "");

  if (!organizationId || !kind || !payoutDateRaw) {
    redirect(`/payroll/new?error=${encodeURIComponent("Заполните организацию, вид расчёта и дату выплаты")}`);
  }

  const payoutDate = new Date(payoutDateRaw);
  try {
    await assertPeriodOpenForDate(payoutDate);
  } catch (e) {
    redirect(`/payroll/new?error=${encodeURIComponent((e as Error).message)}`);
  }

  const period = await getOrCreatePeriod(payoutDate.getUTCFullYear(), payoutDate.getUTCMonth() + 1);

  const run = await prisma.payrollRun.create({
    data: { organizationId, periodId: period.id, kind: kind as never, payoutDate },
  });

  await logAudit({
    userId: session.userId,
    entityType: "payroll_run",
    entityId: run.id,
    action: "create",
    after: run as never,
  });

  revalidatePath("/payroll");
  redirect(`/payroll/${run.id}`);
}

export async function calculatePayrollRunAction(id: string) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id } });
  if (run.status !== "DRAFT" && run.status !== "CALCULATED") {
    redirect(`/payroll/${id}?error=${encodeURIComponent("Пересчитать можно только черновик или уже рассчитанный расчёт")}`);
  }
  try {
    await assertPeriodOpenForDate(run.payoutDate);
  } catch (e) {
    redirect(`/payroll/${id}?error=${encodeURIComponent((e as Error).message)}`);
  }

  const result = await calculatePayrollRun(id, session.userId);

  await logAudit({
    userId: session.userId,
    entityType: "payroll_run",
    entityId: id,
    action: "calculate",
    after: result as never,
  });

  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

export async function addPayrollLineAction(runId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const employeeId = String(formData.get("employeeId") ?? "");
  const accrualTypeId = String(formData.get("accrualTypeId") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const projectId = String(formData.get("projectId") ?? "") || null;

  if (!employeeId || !accrualTypeId || !amountRaw || Number(amountRaw) <= 0) {
    redirect(`/payroll/${runId}?error=${encodeURIComponent("Выберите сотрудника, вид начисления и укажите сумму")}`);
  }

  const [run, accrualType, rates] = await Promise.all([
    prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } }),
    prisma.payrollAccrualType.findUniqueOrThrow({ where: { id: accrualTypeId } }),
    loadTaxRates(),
  ]);

  try {
    await assertPeriodOpenForDate(run.payoutDate);
  } catch (e) {
    redirect(`/payroll/${runId}?error=${encodeURIComponent((e as Error).message)}`);
  }

  const amount = toDecimal(amountRaw);
  const { ndflAmount, insuranceAmount } = computeTaxes(amount, accrualType.subjectToNdfl, accrualType.subjectToInsurance, rates);

  const line = await prisma.payrollLine.create({
    data: { payrollRunId: runId, employeeId, accrualTypeId, departmentId, projectId, amount, ndflAmount, insuranceAmount },
  });
  await prisma.payrollAllocation.create({
    data: { payrollLineId: line.id, departmentId, projectId, sharePct: 100, amount },
  });

  await logAudit({
    userId: session.userId,
    entityType: "payroll_line",
    entityId: line.id,
    action: "create",
    after: line as never,
  });

  revalidatePath(`/payroll/${runId}`);
}

export async function removePayrollLineAction(runId: string, lineId: string) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const line = await prisma.payrollLine.findUniqueOrThrow({ where: { id: lineId } });
  await prisma.payrollLine.delete({ where: { id: lineId } });

  await logAudit({
    userId: session.userId,
    entityType: "payroll_line",
    entityId: lineId,
    action: "delete",
    before: line as never,
  });

  revalidatePath(`/payroll/${runId}`);
}

async function transitionRun(id: string, from: PayrollRunStatus[], to: PayrollRunStatus, action: string, userId: string) {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id } });
  if (!from.includes(run.status)) {
    redirect(`/payroll/${id}?error=${encodeURIComponent(`Действие недоступно для статуса «${run.status}»`)}`);
  }
  const updated = await prisma.payrollRun.update({ where: { id }, data: { status: to } });
  await logAudit({ userId, entityType: "payroll_run", entityId: id, action, before: run as never, after: updated as never });
  revalidatePath(`/payroll/${id}`);
  revalidatePath("/payroll");
}

export async function approvePayrollRunAction(id: string) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  await transitionRun(id, [PayrollRunStatus.CALCULATED], PayrollRunStatus.APPROVED, "approve", session.userId);
}

export async function markPayrollRunPaidAction(id: string) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  await transitionRun(id, [PayrollRunStatus.APPROVED], PayrollRunStatus.PAID, "mark_paid", session.userId);
}
