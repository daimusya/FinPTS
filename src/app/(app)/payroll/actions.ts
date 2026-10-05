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
import { accrualDateForRun, postPayrollRunToAccrual } from "@/lib/payroll/post-to-accrual";
import { toDecimal } from "@/lib/money";
import { isVisible, NOT_VISIBLE, ORGANIZATION_NOT_ALLOWED, organizationAllowed } from "@/lib/access-guard";
import { PayrollRunStatus } from "@prisma/client";
import { parseFormAmount, parseFormDate } from "@/lib/form-values";

export async function createPayrollRunAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  if (!(await organizationAllowed(session, String(formData.get("organizationId") ?? "")))) redirect(`/payroll/new?error=${encodeURIComponent(ORGANIZATION_NOT_ALLOWED)}`);

  const organizationId = String(formData.get("organizationId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const payoutDateRaw = String(formData.get("payoutDate") ?? "");

  if (!organizationId || !kind || !payoutDateRaw) {
    redirect(`/payroll/new?error=${encodeURIComponent("Заполните организацию, вид расчёта и дату выплаты")}`);
  }

  const payoutInput = parseFormDate(payoutDateRaw, "Дата выплаты");
  if ("error" in payoutInput) redirect(`/payroll/new?error=${encodeURIComponent(payoutInput.error)}`);
  const payoutDate = (payoutInput as { date: Date }).date;
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
  if (!(await isVisible(session, "payrollRun", id))) redirect(`/payroll?error=${encodeURIComponent(NOT_VISIBLE)}`);

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
  if (!(await isVisible(session, "payrollRun", runId)) || !(await isVisible(session, "employee", String(formData.get("employeeId") ?? "")))) redirect(`/payroll?error=${encodeURIComponent(NOT_VISIBLE)}`);

  const employeeId = String(formData.get("employeeId") ?? "");
  const accrualTypeId = String(formData.get("accrualTypeId") ?? "");
  const amountInput = parseFormAmount(formData.get("amount"));
  const amountRaw = "value" in amountInput ? amountInput.value : "";
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const projectId = String(formData.get("projectId") ?? "") || null;

  if (!employeeId || !accrualTypeId) {
    redirect(`/payroll/${runId}?error=${encodeURIComponent("Выберите сотрудника, вид начисления и укажите сумму")}`);
  }
  if ("error" in amountInput) redirect(`/payroll/${runId}?error=${encodeURIComponent(amountInput.error)}`);

  const [run, accrualType] = await Promise.all([
    prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } }),
    prisma.payrollAccrualType.findUniqueOrThrow({ where: { id: accrualTypeId } }),
  ]);
  const rates = await loadTaxRates(run.organizationId, run.payoutDate);

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
  if (!(await isVisible(session, "payrollRun", runId)) || !(await isVisible(session, "employee", String(formData.get("avgEmployeeId") ?? "")))) redirect(`/payroll?error=${encodeURIComponent(NOT_VISIBLE)}`);
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

  const rates = await loadTaxRates(run.organizationId, run.payoutDate);
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
        // The P&L spreads it over the months of these days (employer-paid sick days — the first ones).
        absenceStart: request.startDate,
        absenceDays: result.kind === "vacation" ? request.days : Math.min(request.days, result.sick.employerDays),
        comment:
          result.kind === "vacation"
            ? `Средний дневной ${result.vacation.avgDaily.toFixed(2)} × ${request.days} дн. с ${request.startDate.toISOString().slice(0, 10)}${
                result.indexation && (result.vacation.afterPeriod || result.vacation.duringVacation.length || result.vacation.months.some((m) => m.indexCoef))
                  ? ", с индексацией по п. 16 Положения № 922"
                  : ""
              }`
            : `Пособие ${result.sick.dailyBenefit.toFixed(2)} в день (${result.tenure.pct}%)${
                result.sick.monthlyCaps.some((c) => c.applied)
                  ? `, стаж меньше 6 мес. — не больше МРОТ за месяц: ${result.sick.monthlyCaps.map((c) => `${c.capDaily.toFixed(2)} в день за ${c.month}.${c.year}`).join(", ")}`
                  : ""
              }; ${result.sick.employerDays} дн. за счёт работодателя: ${result.sick.employerAmount.toFixed(2)} (всего за ${request.days} дн. — ${result.sick.total.toFixed(2)}, Соцфонд — ${result.sick.fundAmount.toFixed(2)})${
                result.replacement?.used ? `; годы расчёта заменены на ${result.replacement.years.join(" и ")} по заявлению` : ""
              }`,
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
          indexation: result.indexation
            ? {
                months: result.vacation.months.filter((m) => m.indexCoef).map((m) => ({ month: `${m.year}-${m.month}`, coef: m.indexCoef!.toFixed(4) })),
                afterPeriodCoef: result.vacation.afterPeriod?.coef.toFixed(4) ?? null,
                duringVacation: result.vacation.duringVacation.map((d) => ({ from: d.date.toISOString().slice(0, 10), days: d.days, coef: d.coef.toFixed(4) })),
              }
            : null,
          amount: result.vacation.amount.toFixed(2),
        }
      : {
          kind: "sick",
          start: request.startDate.toISOString().slice(0, 10),
          days: request.days,
          tenure: result.tenure,
          calcYears: result.sick.years.map((y) => y.year),
          replacement: result.replacement
            ? { ...result.replacement, standardTotal: result.replacement.standardTotal.toFixed(2), replacedTotal: result.replacement.replacedTotal.toFixed(2) }
            : null,
          districtCoef: result.sick.districtCoef.toFixed(3),
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
  if (!(await isVisible(session, "payrollRun", runId))) redirect(`/payroll?error=${encodeURIComponent(NOT_VISIBLE)}`);

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
  if (!(await isVisible(session, "payrollRun", id))) redirect(`/payroll?error=${encodeURIComponent(NOT_VISIBLE)}`);
  // The expense goes to the month the run is for; a closed month must be reopened first.
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id } });
  const accrualDate = accrualDateForRun(run.kind, run.payoutDate);
  try {
    await assertPeriodOpenForDate(accrualDate);
  } catch (e) {
    redirect(
      `/payroll/${id}?error=${encodeURIComponent(`${(e as Error).message} Расчёт проводится в расход месяца, за который начислен (${accrualDate.getUTCMonth() + 1}.${accrualDate.getUTCFullYear()}), — откройте период в «Администрирование → Периоды», утвердите расчёт и закройте период снова.`)}`,
    );
  }
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
  if (!(await isVisible(session, "payrollRun", id))) redirect(`/payroll?error=${encodeURIComponent(NOT_VISIBLE)}`);
  await transitionRun(id, [PayrollRunStatus.APPROVED], PayrollRunStatus.PAID, "mark_paid", session.userId);
}
