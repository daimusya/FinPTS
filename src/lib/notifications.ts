import { prisma } from "@/lib/db";
import { scheduleDelivery, usersWithDelivery } from "@/lib/notify-channels/deliver";

export interface NotificationInput {
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Уведомления пользователям в самой системе (колокольчик в верхней панели,
 * страница «Уведомления»). Получатели без повторов; автор события себе
 * уведомлений не шлёт (exceptUserId). Тем, кто включил почту или Telegram,
 * уведомление дублируется туда же — после ответа, с повтором по расписанию
 * при сбое (src/lib/notify-channels).
 */
export async function notify(userIds: Array<string | null | undefined>, input: NotificationInput, exceptUserId?: string): Promise<number> {
  const recipients = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== exceptUserId))];
  if (recipients.length === 0) return 0;
  const body = input.body?.slice(0, 2000) ?? null;
  const external = await usersWithDelivery(recipients);
  const created = await prisma.notification.createManyAndReturn({
    data: recipients.map((userId) => ({
      userId,
      title: input.title.slice(0, 300),
      body,
      link: input.link ?? null,
      deliveryState: external.has(userId) ? "pending" : null,
    })),
    select: { id: true, deliveryState: true },
  });
  await scheduleDelivery(created.filter((n) => n.deliveryState === "pending").map((n) => n.id));
  return created.length;
}

export function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
