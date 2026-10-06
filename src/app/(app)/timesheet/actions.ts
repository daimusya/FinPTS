"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { isVisible, NOT_VISIBLE } from "@/lib/access-guard";
import { getAccessScope, projectScopeWhere } from "@/lib/access-scope";
import { assertPeriodOpenForDate } from "@/lib/period";
import { monthsTouched, parseTimesheetFill } from "@/lib/payroll/timesheet-fill";

const back = (param: "error" | "notice", message: string): never => redirect(`/timesheet?${param}=${encodeURIComponent(message)}`);
import { isWorkingDay, type CalendarOverrides, toCalendarOverrides } from "@/lib/payroll/work-calendar";

export async function bulkFillTimesheetAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const employeeIds = formData.getAll("employeeIds").map(String);
  // Only employees visible to this user.
  for (const employeeId of employeeIds) {
    if (!(await isVisible(session, "employee", employeeId))) back("error", NOT_VISIBLE);
  }
  const dateFromRaw = String(formData.get("dateFrom") ?? "");
  const dateToRaw = String(formData.get("dateTo") ?? "");
  const projectId = String(formData.get("projectId") ?? "") || null;
  const skipWeekends = formData.get("skipWeekends") === "on";

  const parsed = parseTimesheetFill({
    employeeCount: employeeIds.length,
    dateFrom: dateFromRaw,
    dateTo: dateToRaw,
    dayType: String(formData.get("dayType") ?? ""),
    hours: String(formData.get("hours") ?? "8"),
  });
  if ("error" in parsed) back("error", parsed.error);
  const { dateFrom, dateTo, dayType, hours } = parsed as Exclude<typeof parsed, { error: string }>;
  if (projectId && (await prisma.project.count({ where: { id: projectId, ...projectScopeWhere(await getAccessScope(session)) } })) === 0) {
    back("error", NOT_VISIBLE);
  }
  // The timesheet feeds payroll: months already closed are not changed.
  for (const month of monthsTouched(dateFrom, dateTo)) {
    await assertPeriodOpenForDate(month).catch((e) => back("error", (e as Error).message));
  }

  // Weekends and holidays per the production calendar (without calendar rows — plain Saturday/Sunday).
  const calendarRows = skipWeekends
    ? await prisma.productionCalendarDay.findMany({ where: { isArchived: false, date: { gte: dateFrom, lte: dateTo } } })
    : [];
  const calendar: CalendarOverrides = toCalendarOverrides(calendarRows);
  const dates: Date[] = [];
  for (let d = new Date(dateFrom); d <= dateTo; d.setUTCDate(d.getUTCDate() + 1)) {
    if (skipWeekends && !isWorkingDay(d, calendar)) continue;
    dates.push(new Date(d));
  }

  // Not upsert: the unique key includes projectId, which Prisma rejects as null in `where` — and PostgreSQL
  // does not enforce uniqueness for NULLs anyway. Existing entries are read once (not per employee and day),
  // then updated and created in one transaction: all or nothing.
  const dayKey = (employeeId: string, date: Date) => `${employeeId}|${date.toISOString().slice(0, 10)}`;
  const existingRows = await prisma.timeSheet.findMany({
    where: { employeeId: { in: employeeIds }, date: { gte: dateFrom, lte: dateTo }, dayType, projectId },
    select: { id: true, employeeId: true, date: true },
  });
  const existing = new Map(existingRows.map((row) => [dayKey(row.employeeId, row.date), row.id]));
  const toUpdate: string[] = [];
  const toCreate: Array<{ employeeId: string; date: Date; dayType: string; hours: number; projectId: string | null }> = [];
  for (const employeeId of employeeIds) {
    for (const date of dates) {
      const id = existing.get(dayKey(employeeId, date));
      if (id) toUpdate.push(id);
      else toCreate.push({ employeeId, date, dayType, hours, projectId });
    }
  }
  await prisma.$transaction([
    prisma.timeSheet.updateMany({ where: { id: { in: toUpdate } }, data: { hours } }),
    prisma.timeSheet.createMany({ data: toCreate }),
  ]);
  const count = toUpdate.length + toCreate.length;

  await logAudit({
    userId: session.userId,
    entityType: "time_sheet",
    entityId: "bulk",
    action: "bulk_fill",
    after: { employeeIds, dateFrom: dateFromRaw, dateTo: dateToRaw, dayType, hours, count } as never,
  });

  revalidatePath("/timesheet");
  back(
    "notice",
    count > 0 ? `Табель заполнен, записей: ${count}` : "В выбранном периоде нет рабочих дней — табель не изменён",
  );
}

export async function deleteTimesheetEntryAction(id: string) {
  const session = await requirePermission(PERMISSIONS.PAYROLL_MANAGE);

  const entry = await prisma.timeSheet.findUniqueOrThrow({ where: { id } });
  if (!(await isVisible(session, "employee", entry.employeeId))) back("error", NOT_VISIBLE);
  await assertPeriodOpenForDate(entry.date).catch((e) => back("error", (e as Error).message));
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
