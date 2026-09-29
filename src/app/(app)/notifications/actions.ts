"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";

/** Открыть уведомление: отметить прочитанным и перейти по его ссылке. */
export async function openNotificationAction(id: string) {
  const session = await requireSession();
  const notification = await prisma.notification.findFirst({ where: { id, userId: session.userId } });
  if (!notification) redirect("/notifications");
  if (!notification!.readAt) await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  // Only links inside the app.
  redirect(notification!.link && notification!.link.startsWith("/") ? notification!.link : "/notifications");
}

export async function markAllNotificationsReadAction() {
  const session = await requireSession();
  await prisma.notification.updateMany({ where: { userId: session.userId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  redirect("/notifications");
}
