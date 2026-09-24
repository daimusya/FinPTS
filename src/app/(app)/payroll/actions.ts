"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate, getOrCreatePeriod } from "@/lib/period";
import { PERMISSIONS } from "@/lib/permissions";
import {
  calculatePayrollRun,
  computeTaxes,
  loadTaxRates,
  PayrollCalculationError,
  splitByProjectShares,
} from "@/lib/payroll/calculate";
import {
  AVERAGE_FIELDS,
  computeAverageEarnings,
  parseAverageRequest,
  type AverageEarningsPreview,
  type AverageEarningsRequest,
} from "@/lib/payroll/average-earnings-db";
import { postPayrollRunToAccrual } from "@/lib/payroll/post-to-accrual";
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

  let result: Awaited<ReturnType<typeof calculatePayrollRun>>;
  try {
    result = await calculatePayrollRun(id, session.userId);
  } catch (e) {
    if (e instanceof PayrollCalculationError) redirect(`/payroll/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }

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

/**
 * Добавляет строку «Отпускные» или «Больничные», рассчитанную по среднему
 * заработку. Сумма пересчитывается здесь заново по тем же параметрам, что
 * и предпросмотр на странице, — из формы берутся только параметры.
 */
export async function addAverageEarningsLineAction(runId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  const back = (message: string): never => redirect(`/payroll/${runId}?error=${encodeURIComponent(message)}`);

  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status !== "DRAFT" && run.status !== "CALCULATED") back("Добавлять строки можно только в черновик или рассчитанный расчёт");
  try {
    await assertPeriodOpenForDate(run.payoutDate);
  } catch (e) {
    back((e as Error).message);
  }

  const params = Object.fromEntries(AVERAGE_FIELDS.map((f) => [f, String(formData.get(f) ?? "")]));
  const parsed = parseAverageRequest(params);
  if ("error" in parsed) back(parsed.error);
  const { request } = parsed as { request: AverageEarningsRequest };

  let preview: AverageEarningsPreview;
  try {
    preview = await computeAverageEarnings(request);
  } catch (e) {
    back((e as Error).message);
  }
  if (preview!.employee.organizationId !== run.organizationId) back("Сотрудник не из организации этого расчёта");
  const result = preview!;

  const accrualType = await prisma.payrollAccrualType.findFirst({ where: { code: result.accrualCode, isArchived: false } });
  if (!accrualType) back(`В справочнике «Виды начислений зарплаты» нет активного вида с кодом ${result.accrualCode}`);

  const rates = await loadTaxRates();
  const amount = result.lineAmount;
  const { ndflAmount, insuranceAmount } = computeTaxes(amount, accrualType!.subjectToNdfl, accrualType!.subjectToInsurance, rates);
  const shares = await prisma.employeeProjectAllocation.findMany({ where: { employeeId: result.employee.id, validTo: null } });
  const splits = splitByProjectShares(
    amount,
    shares.map((s) => ({ projectId: s.projectId, sharePct: toDecimal(s.sharePct) })),
    result.employee.departmentId,
  );

  const line = await prisma.$transaction(async (tx) => {
    const created = await tx.payrollLine.create({
      data: {
        payrollRunId: runId,
        employeeId: result.employee.id,
        accrualTypeId: accrualType!.id,
        departmentId: result.employee.departmentId,
        amount,
        ndflAmount,
        insuranceAmount,
        comment:
          result.kind === "vacation"
            ? `Средний дневной ${result.vacation.avgDaily.toFixed(2)} × ${request.days} дн. с ${request.startDate.toISOString().slice(0, 10)}`
            : `Пособие ${result.sick.dailyBenefit.toFixed(2)} в день × ${result.sick.employerDays} дн. за счёт работодателя (всего за ${request.days} дн. — ${result.sick.total.toFixed(2)}, Соцфонд — ${result.sick.fundAmount.toFixed(2)})`,
      },
    });
    await tx.payrollAllocation.createMany({
      data: splits.map((s) => ({
        payrollLineId: created.id,
        departmentId: s.departmentId ?? result.employee.departmentId,
        projectId: s.projectId,
        sharePct: s.sharePct,
        amount: s.amount,
      })),
    });
    return created;
  });

  const calculation =
    result.kind === "vacation"
      ? {
          kind: "vacation",
          start: request.startDate.toISOString().slice(0, 10),
          days: request.days,
          method: result.vacation.method,
          earnings: result.vacation.totalEarnings.toFixed(2),
          periodDays: result.vacation.totalDays.toFixed(4),
          avgDaily: result.vacation.avgDaily.toFixed(2),
        }
      : {
          kind: "sick",
          start: request.startDate.toISOString().slice(0, 10),
          days: request.days,
          tenurePct: request.tenurePct,
          basis: result.sick.basis,
          avgDaily: result.sick.avgDaily.toFixed(2),
          dailyBenefit: result.sick.dailyBenefit.toFixed(2),
          total: result.sick.total.toFixed(2),
          employerAmount: result.sick.employerAmount.toFixed(2),
          fundAmount: result.sick.fundAmount.toFixed(2),
        };
  await logAudit({
    userId: session.userId,
    entityType: "payroll_line",
    entityId: line.id,
    action: "create_by_average_earnings",
    after: { ...line, calculation } as never,
  });

  revalidatePath(`/payroll/${runId}`);
  redirect(`/payroll/${runId}`);
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

  const accrualDocumentId = await postPayrollRunToAccrual(id);
  if (accrualDocumentId) {
    await logAudit({
      userId: session.userId,
      entityType: "payroll_run",
      entityId: id,
      action: "post_to_accrual",
      after: { accrualDocumentId } as never,
      accrualDocumentId,
    });
    revalidatePath("/accruals");
  }
}

export async function markPayrollRunPaidAction(id: string) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  await transitionRun(id, [PayrollRunStatus.APPROVED], PayrollRunStatus.PAID, "mark_paid", session.userId);
}
