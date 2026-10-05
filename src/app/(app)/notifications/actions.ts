"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { findChatByCode, makeLinkCode } from "@/lib/notify-channels/compose";
import { loadChannelSettings } from "@/lib/notify-channels/deliver";
import { telegramCall, type TelegramUpdate } from "@/lib/notify-channels/transport";
import { isInternalPath } from "@/lib/internal-path";

/** Открыть уведомление: отметить прочитанным и перейти по его ссылке. */
export async function openNotificationAction(id: string) {
  const session = await requireSession();
  const notification = await prisma.notification.findFirst({ where: { id, userId: session.userId } });
  if (!notification) redirect("/notifications");
  if (!notification!.readAt) await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  // Only links inside the app.
  redirect(isInternalPath(notification!.link) ? notification!.link : "/notifications");
}

export async function markAllNotificationsReadAction() {
  const session = await requireSession();
  await prisma.notification.updateMany({ where: { userId: session.userId, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/", "layout");
  redirect("/notifications");
}

const back = (param: "channelError" | "channelNotice", message: string): never =>
  redirect(`/notifications?${param}=${encodeURIComponent(message)}#channels`);

/** Свои каналы: дублировать уведомления на почту и в Telegram. */
export async function saveMyChannelsAction(formData: FormData) {
  const session = await requireSession();
  const settings = await loadChannelSettings();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const notifyEmail = formData.get("notifyEmail") === "on";
  const notifyTelegram = formData.get("notifyTelegram") === "on";
  if (notifyEmail && !settings.smtp.enabled) back("channelError", "Почта для уведомлений не настроена администратором");
  if (notifyTelegram && !(settings.telegram.enabled && user.telegramChatId)) back("channelError", "Сначала привяжите Telegram ниже");
  await prisma.user.update({ where: { id: user.id }, data: { notifyEmail, notifyTelegram } });
  await logAudit({ userId: user.id, entityType: "user", entityId: user.id, action: "notification_channels", after: { notifyEmail, notifyTelegram } as never });
  back("channelNotice", "Сохранено");
}

/** Привязка Telegram, шаг 1: код, который пользователь отправляет боту. */
export async function startTelegramLinkAction() {
  const session = await requireSession();
  const settings = await loadChannelSettings();
  if (!settings.telegram.enabled || !settings.telegram.tokenEnc) back("channelError", "Telegram для уведомлений не настроен администратором");
  await prisma.user.update({ where: { id: session.userId }, data: { telegramLinkCode: makeLinkCode() } });
  back("channelNotice", "Отправьте боту код ниже и нажмите «Проверить»");
}

/** Привязка Telegram, шаг 2: найти сообщение с кодом среди новых сообщений бота. */
export async function checkTelegramLinkAction() {
  const session = await requireSession();
  const settings = await loadChannelSettings();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!user.telegramLinkCode || !settings.telegram.tokenEnc) back("channelError", "Нажмите «Привязать Telegram», чтобы получить код");
  let chatId: string | null = null;
  try {
    const updates = await telegramCall<TelegramUpdate[]>(decryptSecret(settings.telegram.tokenEnc!), "getUpdates", { allowed_updates: ["message"], limit: 100 });
    chatId = findChatByCode(updates, user.telegramLinkCode!);
  } catch (error) {
    back("channelError", error instanceof Error ? error.message : String(error));
  }
  if (!chatId) back("channelError", `Бот ещё не получил код ${user.telegramLinkCode} — отправьте его боту и нажмите «Проверить» ещё раз`);
  await prisma.user.update({ where: { id: user.id }, data: { telegramChatId: chatId, telegramLinkCode: null, notifyTelegram: true } });
  await logAudit({ userId: user.id, entityType: "user", entityId: user.id, action: "telegram_link", after: { linked: true } as never });
  back("channelNotice", "Telegram привязан — уведомления будут приходить и туда");
}

export async function unlinkTelegramAction() {
  const session = await requireSession();
  await prisma.user.update({ where: { id: session.userId }, data: { telegramChatId: null, telegramLinkCode: null, notifyTelegram: false } });
  await logAudit({ userId: session.userId, entityType: "user", entityId: session.userId, action: "telegram_unlink" });
  back("channelNotice", "Telegram отвязан");
}
