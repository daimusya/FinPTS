"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";
import { composeEmail, composeTelegram, normalizeAppUrl, validateBotToken, validateSmtp } from "@/lib/notify-channels/compose";
import { CHANNELS_PROFILE_SYSTEM, deliverPendingNotifications, loadChannelSettings } from "@/lib/notify-channels/deliver";
import { sendEmail, telegramCall } from "@/lib/notify-channels/transport";

const PAGE = "/admin/notification-channels";
const back = (param: "error" | "notice", message: string): never => redirect(`${PAGE}?${param}=${encodeURIComponent(message)}`);

/** Сохранить адрес системы, почтовый сервер и бота. Пустые пароль и токен — оставить прежние. */
export async function saveChannelSettingsAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.ADMIN_FULL);
  const current = await loadChannelSettings();

  const appUrl = normalizeAppUrl(String(formData.get("appUrl") ?? ""));
  if ("error" in appUrl) back("error", appUrl.error);
  const smtp = validateSmtp({
    enabled: formData.get("smtpEnabled") === "on",
    host: String(formData.get("smtpHost") ?? ""),
    port: String(formData.get("smtpPort") ?? ""),
    security: String(formData.get("smtpSecurity") ?? ""),
    user: String(formData.get("smtpUser") ?? ""),
    from: String(formData.get("smtpFrom") ?? ""),
  });
  if ("error" in smtp) back("error", smtp.error);
  const password = String(formData.get("smtpPassword") ?? "");
  const passwordEnc = password ? encryptSecret(password) : current.smtp.passwordEnc;

  const tokenRaw = String(formData.get("telegramToken") ?? "");
  let tokenEnc = current.telegram.tokenEnc;
  let botUsername = current.telegram.botUsername;
  if (tokenRaw.trim()) {
    const token = validateBotToken(tokenRaw);
    if ("error" in token) back("error", token.error);
    const value = (token as { value: string }).value;
    // The token is checked with Telegram right away: a typo is caught here, not on the first notification.
    try {
      const me = await telegramCall<{ username?: string }>(value, "getMe");
      botUsername = me.username ?? null;
    } catch (error) {
      back("error", error instanceof Error ? error.message : String(error));
    }
    tokenEnc = encryptSecret(value);
  }
  const telegramEnabled = formData.get("telegramEnabled") === "on";
  if (telegramEnabled && !tokenEnc) back("error", "Укажите токен бота перед включением Telegram");

  const config = {
    appUrl: (appUrl as { value: string }).value,
    smtp: { ...(smtp as { value: Omit<typeof current.smtp, "passwordEnc"> }).value, passwordEnc },
    telegram: { enabled: telegramEnabled, tokenEnc, botUsername },
  };
  const existing = await prisma.integrationProfile.findFirst({ where: { system: CHANNELS_PROFILE_SYSTEM } });
  const isEnabled = config.smtp.enabled || config.telegram.enabled;
  const profile = existing
    ? await prisma.integrationProfile.update({ where: { id: existing.id }, data: { isEnabled, config } })
    : await prisma.integrationProfile.create({ data: { system: CHANNELS_PROFILE_SYSTEM, name: "Каналы уведомлений: почта и Telegram", isEnabled, config } });
  await logAudit({
    userId: session.userId,
    entityType: "integration_profile",
    entityId: profile.id,
    action: "update",
    after: {
      system: CHANNELS_PROFILE_SYSTEM,
      appUrl: config.appUrl,
      smtp: {
        enabled: config.smtp.enabled,
        host: config.smtp.host,
        port: config.smtp.port,
        security: config.smtp.security,
        user: config.smtp.user,
        from: config.smtp.from,
        passwordChanged: Boolean(password),
      },
      telegram: { enabled: config.telegram.enabled, botUsername, tokenChanged: Boolean(tokenRaw.trim()) },
    } as never,
  });
  revalidatePath(PAGE);
  back("notice", "Настройки каналов сохранены");
}

/** Тестовое письмо себе — проверить сервер, логин и пароль. */
export async function sendTestEmailAction() {
  const session = await requirePermission(PERMISSIONS.ADMIN_FULL);
  const settings = await loadChannelSettings();
  if (!settings.smtp.host) back("error", "Сначала укажите и сохраните почтовый сервер");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  try {
    await sendEmail(settings.smtp, settings.smtp.passwordEnc ? decryptSecret(settings.smtp.passwordEnc) : null, {
      to: user.email,
      ...composeEmail({ title: "Проверка почты — всё работает", body: "Это тестовое письмо со страницы «Каналы уведомлений».", link: "/notifications" }, settings.appUrl),
    });
  } catch (error) {
    back("error", `Письмо не отправлено: ${error instanceof Error ? error.message : String(error)}`);
  }
  back("notice", `Тестовое письмо отправлено на ${user.email}`);
}

/** Тестовое сообщение себе в Telegram (нужен привязанный чат на странице «Уведомления»). */
export async function sendTestTelegramAction() {
  const session = await requirePermission(PERMISSIONS.ADMIN_FULL);
  const settings = await loadChannelSettings();
  if (!settings.telegram.tokenEnc) back("error", "Сначала укажите и сохраните токен бота");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  if (!user.telegramChatId) back("error", "Сначала привяжите свой Telegram на странице «Уведомления»");
  try {
    await telegramCall(decryptSecret(settings.telegram.tokenEnc!), "sendMessage", {
      chat_id: user.telegramChatId,
      text: composeTelegram({ title: "Проверка Telegram — всё работает", body: null, link: "/notifications" }, settings.appUrl),
      parse_mode: "HTML",
    });
  } catch (error) {
    back("error", `Сообщение не отправлено: ${error instanceof Error ? error.message : String(error)}`);
  }
  back("notice", "Тестовое сообщение отправлено в Telegram");
}

/** Повторить отправку уведомлений, которые не ушли (после исправления настроек). */
export async function retryDeliveryAction() {
  await requirePermission(PERMISSIONS.ADMIN_FULL);
  // Failed ones get a fresh set of attempts.
  const reset = await prisma.notification.updateMany({ where: { deliveryState: "failed" }, data: { deliveryState: "pending", deliveryAttempts: 0 } });
  const result = await deliverPendingNotifications();
  revalidatePath(PAGE);
  back("notice", `Повтор отправки: доставлено ${result.sent}, ждут ${result.pending}, не удалось ${result.failed}${reset.count ? ` (возвращено в очередь ${reset.count})` : ""}`);
}
