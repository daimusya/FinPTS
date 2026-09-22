"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";

export async function bulkFillTimesheetAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const employeeIds = formData.getAll("employeeIds").map(String);
  const dateFromRaw = String(formData.get("dateFrom") ?? "");
  const dateToRaw = String(formData.get("dateTo") ?? "");
  const dayType = String(formData.get("dayType") ?? "");
  const hoursRaw = String(formData.get("hours") ?? "8");
  const projectId = String(formData.get("projectId") ?? "") || null;
  const skipWeekends = formData.get("skipWeekends") === "on";

  if (employeeIds.length === 0 || !dateFromRaw || !dateToRaw || !dayType) {
    return;
  }

  const dateFrom = new Date(dateFromRaw);
  const dateTo = new Date(dateToRaw);
  const hours = Number(hoursRaw) || 0;

  const dates: Date[] = [];
  for (let d = new Date(dateFrom); d <= dateTo; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (skipWeekends && (dow === 0 || dow === 6)) continue;
    dates.push(new Date(d));
  }

  let count = 0;
  for (const employeeId of employeeIds) {
    for (const date of dates) {
      await prisma.timeSheet.upsert({
        where: {
          employeeId_date_dayType_projectId: { employeeId, date, dayType, projectId: projectId as never },
        },
        update: { hours },
        create: { employeeId, date, dayType, hours, projectId },
      });
      count += 1;
    }
  }

  await logAudit({
    userId: session.userId,
    entityType: "time_sheet",
    entityId: "bulk",
    action: "bulk_fill",
    after: { employeeIds, dateFrom: dateFromRaw, dateTo: dateToRaw, dayType, hours, count } as never,
  });

  revalidatePath("/timesheet");
}

export async function deleteTimesheetEntryAction(id: string) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const entry = await prisma.timeSheet.findUniqueOrThrow({ where: { id } });
  await prisma.timeSheet.delete({ where: { id } });

  await logAudit({
    userId: session.userId,
    entityType: "time_sheet",
    entityId: id,
    action: "delete",
    before: entry as never,
  });

  revalidatePath("/timesheet");
}
