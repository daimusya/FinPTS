"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { isVisible, NOT_VISIBLE, ORGANIZATION_NOT_ALLOWED, organizationAllowed } from "@/lib/access-guard";
import { analyticsProblem, getAccessScope } from "@/lib/access-scope";
import { EmployeeStatus, Prisma } from "@prisma/client";
import { parseFormAmount, parseFormDate } from "@/lib/form-values";
import { yearProblem } from "@/lib/form-values";
import { salaryChangeProblem, terminationProblem, transferProblem } from "@/lib/payroll/employment";
import { assertPeriodOpenForDate } from "@/lib/period";
import { STALE_EDIT, VERSION_FIELD, editVersion, versionMatches } from "@/lib/edit-version";

/** Страховой стаж до приёма: целое число месяцев 0–720 или пусто. */
function parsePriorMonths(raw: unknown): { value: number | null } | { error: string } {
  const s = String(raw ?? "").trim();
  if (s === "") return { value: null };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 720) return { error: "Страховой стаж до приёма — целое число месяцев от 0 до 720" };
  return { value: n };
}

export async function hireEmployeeAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  if (!(await organizationAllowed(session, String(formData.get("organizationId") ?? "")))) redirect(`/employees/new?error=${encodeURIComponent(ORGANIZATION_NOT_ALLOWED)}`);

  const fullName = String(formData.get("fullName") ?? "").trim();
  const organizationId = String(formData.get("organizationId") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  // A user limited to some departments hires only into them — otherwise the employee would vanish from their view.
  const departmentProblem = analyticsProblem(await getAccessScope(session), departmentId);
  if (departmentProblem) redirect(`/employees/new?error=${encodeURIComponent(departmentProblem)}`);
  const positionId = String(formData.get("positionId") ?? "") || null;
  const workScheduleId = String(formData.get("workScheduleId") ?? "") || null;
  const hireDateRaw = String(formData.get("hireDate") ?? "");
  const paymentMethod = String(formData.get("paymentMethod") ?? "BANK");
  const bankAccount = String(formData.get("bankAccount") ?? "").trim() || null;
  const salaryRaw = String(formData.get("salary") ?? "");
  const personnelNumber = String(formData.get("personnelNumber") ?? "").trim() || null;
  const prior = parsePriorMonths(formData.get("priorInsuranceMonths"));

  if (!fullName || !organizationId || !hireDateRaw) {
    redirect(`/employees/new?error=${encodeURIComponent("Заполните ФИО, организацию и дату приёма")}`);
  }
  const hireInput = parseFormDate(hireDateRaw, "Дата приёма");
  if ("error" in hireInput) redirect(`/employees/new?error=${encodeURIComponent(hireInput.error)}`);
  const hireSalary = salaryRaw.trim() ? parseFormAmount(salaryRaw, "Оклад") : null;
  if (hireSalary && "error" in hireSalary) redirect(`/employees/new?error=${encodeURIComponent(hireSalary.error)}`);

  const employee = await prisma.employee.create({
    data: {
      fullName,
      organizationId,
      departmentId,
      positionId,
      workScheduleId,
      hireDate: (hireInput as { date: Date }).date,
      paymentMethod: paymentMethod as never,
      bankAccount,
      salary: hireSalary && "value" in hireSalary ? hireSalary.value : null,
      personnelNumber,
      priorInsuranceMonths: "error" in prior ? null : prior.value,
      status: EmployeeStatus.ACTIVE,
    },
  });

  await prisma.employmentHistory.create({
    data: {
      employeeId: employee.id,
      eventType: "hire",
      eventDate: (hireInput as { date: Date }).date,
      toDepartmentId: departmentId,
      toPositionId: positionId,
      toSalary: hireSalary && "value" in hireSalary ? hireSalary.value : null,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "employee",
    entityId: employee.id,
    action: "hire",
    after: employee as never,
  });

  revalidatePath("/employees");
  redirect(`/employees/${employee.id}`);
}

export async function updateEmployeeAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  if (!(await isVisible(session, "employee", id))) redirect(`/employees?error=${encodeURIComponent(NOT_VISIBLE)}`);

  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });
  if (!versionMatches(formData.get(VERSION_FIELD), editVersion(before, ["workScheduleId", "paymentMethod", "bankAccount", "salary", "personnelNumber", "priorInsuranceMonths"]))) {
    redirect(`/employees/${id}/edit?error=${encodeURIComponent(STALE_EDIT)}`);
  }

  const workScheduleId = String(formData.get("workScheduleId") ?? "") || null;
  const paymentMethod = String(formData.get("paymentMethod") ?? "BANK");
  const bankAccount = String(formData.get("bankAccount") ?? "").trim() || null;
  const salaryRaw = String(formData.get("salary") ?? "");
  const personnelNumber = String(formData.get("personnelNumber") ?? "").trim() || null;
  const prior = parsePriorMonths(formData.get("priorInsuranceMonths"));
  if ("error" in prior) redirect(`/employees/${id}/edit?error=${encodeURIComponent(prior.error)}`);

  const salaryInput = salaryRaw.trim() ? parseFormAmount(salaryRaw, "Оклад") : null;
  if (salaryInput && "error" in salaryInput) redirect(`/employees/${id}/edit?error=${encodeURIComponent(salaryInput.error)}`);
  // A changed salary goes into the employment history with its effective date — the average earnings need it.
  const newSalary = salaryInput && "value" in salaryInput ? new Prisma.Decimal(salaryInput.value) : null;
  const oldSalary = before.salary ? new Prisma.Decimal(before.salary) : null;
  const salaryChanged = Boolean(newSalary) && (!oldSalary || !newSalary!.equals(oldSalary));
  const salaryFromRaw = String(formData.get("salaryFrom") ?? "");
  if (salaryChanged && !/^\d{4}-\d{2}-\d{2}$/.test(salaryFromRaw)) {
    redirect(`/employees/${id}/edit?error=${encodeURIComponent("Укажите, с какой даты действует новый оклад")}`);
  }
  const salaryFromYear = salaryChanged ? yearProblem(salaryFromRaw) : null;
  if (salaryFromYear) redirect(`/employees/${id}/edit?error=${encodeURIComponent(`Оклад действует с: ${salaryFromYear}`)}`);
  const salaryFromBlocked = salaryChanged ? salaryChangeProblem(before, new Date(`${salaryFromRaw}T00:00:00.000Z`)) : null;
  if (salaryFromBlocked) redirect(`/employees/${id}/edit?error=${encodeURIComponent(salaryFromBlocked)}`);

  const updated = await prisma.$transaction(async (db) => {
    const saved = await db.employee.update({
      where: { id },
      data: {
        workScheduleId,
        paymentMethod: paymentMethod as never,
        bankAccount,
        salary: salaryInput && "value" in salaryInput ? salaryInput.value : null,
        personnelNumber,
        priorInsuranceMonths: (prior as { value: number | null }).value,
      },
    });
    if (salaryChanged) {
      await db.employmentHistory.create({
        data: {
          employeeId: id,
          eventType: "salary_change",
          eventDate: new Date(`${salaryFromRaw}T00:00:00.000Z`),
          fromSalary: oldSalary,
          toSalary: newSalary,
          toDepartmentId: before.departmentId,
          toPositionId: before.positionId,
        },
      });
    }
    return saved;
  });

  await logAudit({
    userId: session.userId,
    entityType: "employee",
    entityId: id,
    action: "update",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}`);
}

export async function transferEmployeeAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  if (!(await isVisible(session, "employee", id))) redirect(`/employees?error=${encodeURIComponent(NOT_VISIBLE)}`);

  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });

  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const departmentProblem = analyticsProblem(await getAccessScope(session), departmentId);
  if (departmentProblem) redirect(`/employees/${id}/transfer?error=${encodeURIComponent(departmentProblem)}`);
  const positionId = String(formData.get("positionId") ?? "") || null;
  const eventDateRaw = String(formData.get("eventDate") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  const transferInput = parseFormDate(eventDateRaw, "Дата перевода");
  if ("error" in transferInput) redirect(`/employees/${id}/transfer?error=${encodeURIComponent(transferInput.error)}`);
  const transferDate = (transferInput as { date: Date }).date;
  const transferBlocked = transferProblem(before, transferDate);
  if (transferBlocked) redirect(`/employees/${id}/transfer?error=${encodeURIComponent(transferBlocked)}`);
  // Payroll of closed months must not change retroactively.
  await assertPeriodOpenForDate(transferDate).catch((e) => redirect(`/employees/${id}/transfer?error=${encodeURIComponent((e as Error).message)}`));

  const updated = await prisma.employee.update({
    where: { id },
    data: { departmentId, positionId },
  });

  await prisma.employmentHistory.create({
    data: {
      employeeId: id,
      eventType: "transfer",
      eventDate: (transferInput as { date: Date }).date,
      fromDepartmentId: before.departmentId,
      toDepartmentId: departmentId,
      fromPositionId: before.positionId,
      toPositionId: positionId,
      comment,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "employee",
    entityId: id,
    action: "transfer",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}`);
}

export async function terminateEmployeeAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  if (!(await isVisible(session, "employee", id))) redirect(`/employees?error=${encodeURIComponent(NOT_VISIBLE)}`);

  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });
  const eventDateRaw = String(formData.get("eventDate") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  const terminationInput = parseFormDate(eventDateRaw, "Дата увольнения");
  if ("error" in terminationInput) redirect(`/employees/${id}/terminate?error=${encodeURIComponent(terminationInput.error)}`);
  const terminationDate = (terminationInput as { date: Date }).date;
  const terminationBlocked = terminationProblem(before, terminationDate);
  if (terminationBlocked) redirect(`/employees/${id}/terminate?error=${encodeURIComponent(terminationBlocked)}`);
  await assertPeriodOpenForDate(terminationDate).catch((e) => redirect(`/employees/${id}/terminate?error=${encodeURIComponent((e as Error).message)}`));

  const updated = await prisma.employee.update({
    where: { id },
    data: { status: EmployeeStatus.TERMINATED, terminationDate },
  });

  await prisma.employmentHistory.create({
    data: {
      employeeId: id,
      eventType: "termination",
      eventDate: terminationDate,
      fromDepartmentId: before.departmentId,
      comment,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "employee",
    entityId: id,
    action: "terminate",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/employees");
  revalidatePath(`/employees/${id}`);
  redirect(`/employees/${id}`);
}

export async function setProjectAllocationAction(employeeId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  if (!(await isVisible(session, "employee", employeeId))) redirect(`/employees?error=${encodeURIComponent(NOT_VISIBLE)}`);

  const projectId = String(formData.get("projectId") ?? "");
  const sharePctRaw = String(formData.get("sharePct") ?? "");

  if (!projectId || !sharePctRaw) {
    redirect(`/employees/${employeeId}?error=${encodeURIComponent("Выберите проект и укажите долю занятости")}`);
  }

  const created = await prisma.employeeProjectAllocation.create({
    data: { employeeId, projectId, sharePct: sharePctRaw },
  });

  await logAudit({
    userId: session.userId,
    entityType: "employee_project_allocation",
    entityId: created.id,
    action: "create",
    after: created as never,
  });

  revalidatePath(`/employees/${employeeId}`);
}

export async function removeProjectAllocationAction(employeeId: string, allocationId: string) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);
  if (!(await isVisible(session, "employee", employeeId))) redirect(`/employees?error=${encodeURIComponent(NOT_VISIBLE)}`);

  await prisma.employeeProjectAllocation.update({
    where: { id: allocationId },
    data: { validTo: new Date() },
  });

  await logAudit({
    userId: session.userId,
    entityType: "employee_project_allocation",
    entityId: allocationId,
    action: "end",
  });

  revalidatePath(`/employees/${employeeId}`);
}
