import { prisma } from "@/lib/db";

export interface NotificationInput {
  title: string;
  body?: string | null;
  link?: string | null;
}

/**
 * Уведомления пользователям в самой системе (колокольчик в верхней панели,
 * страница «Уведомления»). Получатели без повторов; автор события себе
 * уведомлений не шлёт (exceptUserId).
 */
export async function notify(userIds: Array<string | null | undefined>, input: NotificationInput, exceptUserId?: string): Promise<number> {
  const recipients = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== exceptUserId))];
  if (recipients.length === 0) return 0;
  const body = input.body?.slice(0, 2000) ?? null;
  const result = await prisma.notification.createMany({
    data: recipients.map((userId) => ({ userId, title: input.title.slice(0, 300), body, link: input.link ?? null })),
  });
  return result.count;
}

export function unreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
