"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { isWorkingDay, type CalendarOverrides } from "@/lib/payroll/work-calendar";

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

  // Weekends and holidays per the production calendar (without calendar rows — plain Saturday/Sunday).
  const calendarRows = skipWeekends
    ? await prisma.productionCalendarDay.findMany({ where: { isArchived: false, date: { gte: dateFrom, lte: dateTo } } })
    : [];
  const calendar: CalendarOverrides = new Map(
    calendarRows.map((r) => [r.date.toISOString().slice(0, 10), r.kind === "workday" ? "workday" : "holiday"]),
  );
  const dates: Date[] = [];
  for (let d = new Date(dateFrom); d <= dateTo; d.setUTCDate(d.getUTCDate() + 1)) {
    if (skipWeekends && !isWorkingDay(d, calendar)) continue;
    dates.push(new Date(d));
  }

  let count = 0;
  for (const employeeId of employeeIds) {
    for (const date of dates) {
      // Not upsert: the unique key includes projectId, which Prisma rejects as null in `where` — and
      // PostgreSQL does not enforce uniqueness for NULLs anyway, so the check happens here.
      const existing = await prisma.timeSheet.findFirst({ where: { employeeId, date, dayType, projectId } });
      if (existing) {
        await prisma.timeSheet.update({ where: { id: existing.id }, data: { hours } });
      } else {
        await prisma.timeSheet.create({ data: { employeeId, date, dayType, hours, projectId } });
      }
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
