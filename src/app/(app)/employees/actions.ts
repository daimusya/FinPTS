"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { EmployeeStatus } from "@prisma/client";

export async function hireEmployeeAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const fullName = String(formData.get("fullName") ?? "").trim();
  const organizationId = String(formData.get("organizationId") ?? "");
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const positionId = String(formData.get("positionId") ?? "") || null;
  const workScheduleId = String(formData.get("workScheduleId") ?? "") || null;
  const hireDateRaw = String(formData.get("hireDate") ?? "");
  const paymentMethod = String(formData.get("paymentMethod") ?? "BANK");
  const bankAccount = String(formData.get("bankAccount") ?? "").trim() || null;
  const salaryRaw = String(formData.get("salary") ?? "");
  const personnelNumber = String(formData.get("personnelNumber") ?? "").trim() || null;

  if (!fullName || !organizationId || !hireDateRaw) {
    redirect(`/employees/new?error=${encodeURIComponent("Заполните ФИО, организацию и дату приёма")}`);
  }

  const employee = await prisma.employee.create({
    data: {
      fullName,
      organizationId,
      departmentId,
      positionId,
      workScheduleId,
      hireDate: new Date(hireDateRaw),
      paymentMethod: paymentMethod as never,
      bankAccount,
      salary: salaryRaw ? salaryRaw : null,
      personnelNumber,
      status: EmployeeStatus.ACTIVE,
    },
  });

  await prisma.employmentHistory.create({
    data: {
      employeeId: employee.id,
      eventType: "hire",
      eventDate: new Date(hireDateRaw),
      toDepartmentId: departmentId,
      toPositionId: positionId,
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

  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });

  const workScheduleId = String(formData.get("workScheduleId") ?? "") || null;
  const paymentMethod = String(formData.get("paymentMethod") ?? "BANK");
  const bankAccount = String(formData.get("bankAccount") ?? "").trim() || null;
  const salaryRaw = String(formData.get("salary") ?? "");
  const personnelNumber = String(formData.get("personnelNumber") ?? "").trim() || null;

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      workScheduleId,
      paymentMethod: paymentMethod as never,
      bankAccount,
      salary: salaryRaw ? salaryRaw : null,
      personnelNumber,
    },
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

  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });

  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const positionId = String(formData.get("positionId") ?? "") || null;
  const eventDateRaw = String(formData.get("eventDate") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!eventDateRaw) {
    redirect(`/employees/${id}/transfer?error=${encodeURIComponent("Укажите дату перевода")}`);
  }

  const updated = await prisma.employee.update({
    where: { id },
    data: { departmentId, positionId },
  });

  await prisma.employmentHistory.create({
    data: {
      employeeId: id,
      eventType: "transfer",
      eventDate: new Date(eventDateRaw),
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

  const before = await prisma.employee.findUniqueOrThrow({ where: { id } });
  const eventDateRaw = String(formData.get("eventDate") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!eventDateRaw) {
    redirect(`/employees/${id}/terminate?error=${encodeURIComponent("Укажите дату увольнения")}`);
  }

  const updated = await prisma.employee.update({
    where: { id },
    data: { status: EmployeeStatus.TERMINATED, terminationDate: new Date(eventDateRaw) },
  });

  await prisma.employmentHistory.create({
    data: {
      employeeId: id,
      eventType: "termination",
      eventDate: new Date(eventDateRaw),
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
