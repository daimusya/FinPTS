import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/secret-box";
import {
  composeEmail,
  composeTelegram,
  deliveryChannels,
  MAX_DELIVERY_ATTEMPTS,
  readSettings,
  stateAfterAttempt,
  type ChannelSettings,
} from "./compose";
import { sendEmail, telegramCall } from "./transport";

export const CHANNELS_PROFILE_SYSTEM = "NOTIFY_CHANNELS";

export async function loadChannelSettings(): Promise<ChannelSettings> {
  const profile = await prisma.integrationProfile.findFirst({ where: { system: CHANNELS_PROFILE_SYSTEM } });
  return readSettings(profile?.config);
}

/** Пользователи, которым нужна доставка на почту или в Telegram при текущих настройках. */
export async function usersWithDelivery(userIds: string[], settings?: ChannelSettings): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const s = settings ?? (await loadChannelSettings());
  if (!s.smtp.enabled && !s.telegram.enabled) return new Set();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, notifyEmail: true, notifyTelegram: true, telegramChatId: true, isActive: true },
  });
  return new Set(users.filter((u) => { const p = deliveryChannels(u, s); return p.email || p.telegram; }).map((u) => u.id));
}

/**
 * Отправка ожидающих уведомлений на почту и в Telegram. Каждый канал
 * отмечается отдельно, поэтому повтор после частичного сбоя не дублирует
 * уже доставленное. Не больше MAX_DELIVERY_ATTEMPTS попыток, затем failed.
 * ids — только эти уведомления (сразу после создания); без ids — все
 * ожидающие (повтор по расписанию).
 */
export async function deliverPendingNotifications(ids?: string[]): Promise<{ sent: number; failed: number; pending: number }> {
  const settings = await loadChannelSettings();
  const pending = await prisma.notification.findMany({
    where: { deliveryState: "pending", deliveryAttempts: { lt: MAX_DELIVERY_ATTEMPTS }, ...(ids ? { id: { in: ids } } : {}) },
    include: { user: { select: { email: true, notifyEmail: true, notifyTelegram: true, telegramChatId: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  let smtpPassword: string | null | undefined;
  let botToken: string | null | undefined;
  const result = { sent: 0, failed: 0, pending: 0 };

  for (const n of pending) {
    const plan = deliveryChannels(n.user, settings, n);
    const errors: string[] = [];
    let emailSentAt = n.emailSentAt;
    let telegramSentAt = n.telegramSentAt;
    const content = { title: n.title, body: n.body, link: n.link };
    if (plan.email) {
      try {
        if (smtpPassword === undefined) smtpPassword = settings.smtp.passwordEnc ? decryptSecret(settings.smtp.passwordEnc) : null;
        await sendEmail(settings.smtp, smtpPassword, { to: n.user.email, ...composeEmail(content, settings.appUrl) });
        emailSentAt = new Date();
      } catch (error) {
        errors.push(`почта: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (plan.telegram) {
      try {
        if (botToken === undefined) botToken = settings.telegram.tokenEnc ? decryptSecret(settings.telegram.tokenEnc) : null;
        await telegramCall(botToken ?? "", "sendMessage", {
          chat_id: n.user.telegramChatId,
          text: composeTelegram(content, settings.appUrl),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
        telegramSentAt = new Date();
      } catch (error) {
        errors.push(`Telegram: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const attempts = n.deliveryAttempts + 1;
    const state = stateAfterAttempt(attempts, errors.length === 0);
    await prisma.notification.update({
      where: { id: n.id },
      data: {
        deliveryState: state,
        deliveryAttempts: attempts,
        deliveryError: errors.length ? errors.join("; ").slice(0, 1000) : null,
        deliveredAt: state === "sent" ? new Date() : null,
        emailSentAt,
        telegramSentAt,
      },
    });
    result[state] += 1;
  }
  return result;
}

/**
 * Доставить сразу после ответа (в запросе — через after, чтобы кнопка не
 * ждала почтовый сервер); вне запроса (скрипты) — сразу. Ошибки доставки не
 * мешают основному действию: уведомление остаётся в очереди на повтор.
 */
export async function scheduleDelivery(ids: string[]) {
  if (ids.length === 0) return;
  const run = () => deliverPendingNotifications(ids).catch((error) => console.error("Доставка уведомлений:", error));
  try {
    const { after } = await import("next/server");
    after(run);
  } catch {
    await run();
  }
}
