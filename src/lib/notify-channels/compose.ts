/**
 * Каналы доставки уведомлений (почта, Telegram) — чистая часть: проверка
 * настроек, текст письма и сообщения, правила повторов. Отправка — smtp.ts и
 * telegram.ts, очередь — deliver.ts.
 */

export type SmtpSecurity = "ssl" | "starttls" | "none";

export interface SmtpSettings {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  user: string;
  /** Пароль — зашифрованным (secret-box); на странице показывается только маска. */
  passwordEnc: string | null;
  from: string;
}

export interface TelegramSettings {
  enabled: boolean;
  tokenEnc: string | null;
  /** Имя бота из getMe — для подсказки «напишите боту @…». */
  botUsername: string | null;
}

export interface ChannelSettings {
  /** Адрес системы для ссылок в письмах и сообщениях, например https://fin.example.ru. */
  appUrl: string;
  smtp: SmtpSettings;
  telegram: TelegramSettings;
}

export const DEFAULT_SETTINGS: ChannelSettings = {
  appUrl: "http://localhost:3000",
  smtp: { enabled: false, host: "", port: 465, security: "ssl", user: "", passwordEnc: null, from: "" },
  telegram: { enabled: false, tokenEnc: null, botUsername: null },
};

/** Настройки из JSON профиля: недостающее — по умолчанию. */
export function readSettings(raw: unknown): ChannelSettings {
  const value = (raw ?? {}) as Partial<ChannelSettings>;
  return {
    appUrl: typeof value.appUrl === "string" && value.appUrl ? value.appUrl : DEFAULT_SETTINGS.appUrl,
    smtp: { ...DEFAULT_SETTINGS.smtp, ...(value.smtp ?? {}) },
    telegram: { ...DEFAULT_SETTINGS.telegram, ...(value.telegram ?? {}) },
  };
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** Адрес системы: http(s)://хост[:порт], без хвостового слэша. */
export function normalizeAppUrl(raw: string): { value: string } | { error: string } {
  const text = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return { value: `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}` };
  } catch {
    return { error: "Адрес системы — вида https://fin.example.ru (так его открывают в браузере)" };
  }
}

export function validateSmtp(input: { host: string; port: string; security: string; user: string; from: string; enabled: boolean }):
  | { value: Omit<SmtpSettings, "passwordEnc"> }
  | { error: string } {
  const host = input.host.trim();
  const port = Number(input.port);
  const security = (["ssl", "starttls", "none"] as const).find((s) => s === input.security) ?? null;
  const user = input.user.trim();
  const from = input.from.trim();
  if (input.enabled || host) {
    if (!/^[a-z0-9.-]+$/i.test(host)) return { error: "Сервер почты — имя вида smtp.yandex.ru" };
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Порт — число от 1 до 65535 (обычно 465 или 587)" };
    if (!security) return { error: "Выберите шифрование" };
    const address = /<([^>]+)>\s*$/.exec(from)?.[1] ?? from;
    if (!EMAIL.test(address)) return { error: "Адрес отправителя — например fin@example.ru или «ПРОМТЕХНОСФЕРА <fin@example.ru>»" };
    if (/[\r\n]/.test(from) || /[\r\n]/.test(user)) return { error: "В полях не должно быть переносов строк" };
  }
  return { value: { enabled: input.enabled, host, port: Number.isInteger(port) ? port : 465, security: security ?? "ssl", user, from } };
}

/** Токен бота из @BotFather: «123456789:AA…». */
export function validateBotToken(raw: string): { value: string } | { error: string } {
  const token = raw.trim();
  return /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token) ? { value: token } : { error: "Токен бота — вида 123456789:AAE… (выдаёт @BotFather)" };
}

export interface NotificationContent {
  title: string;
  body: string | null;
  link: string | null;
}

export function absoluteLink(appUrl: string, link: string | null): string | null {
  if (!link) return null;
  if (!link.startsWith("/")) return null; // only links inside the app
  return `${appUrl}${link}`;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Письмо: тема — заголовок уведомления, текст и HTML с кнопкой-ссылкой. */
export function composeEmail(n: NotificationContent, appUrl: string): { subject: string; text: string; html: string } {
  const url = absoluteLink(appUrl, n.link);
  const subject = n.title.replace(/[\r\n]+/g, " ").slice(0, 200);
  const text = [n.title, n.body ?? "", url ? `Открыть: ${url}` : "", "", "— Финансовая платформа ПРОМТЕХНОСФЕРА"].filter((l, i) => l || i === 3).join("\n");
  const html = [
    `<p style="font-size:15px;font-weight:600;margin:0 0 8px">${escapeHtml(n.title)}</p>`,
    n.body ? `<p style="margin:0 0 12px;white-space:pre-wrap">${escapeHtml(n.body)}</p>` : "",
    url ? `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}">Открыть в системе</a></p>` : "",
    `<p style="color:#888;font-size:12px;margin:0">Финансовая платформа ПРОМТЕХНОСФЕРА. Отключить письма — на странице «Уведомления».</p>`,
  ].join("");
  return { subject, text, html };
}

/** Сообщение в Telegram (parse_mode HTML). */
export function composeTelegram(n: NotificationContent, appUrl: string): string {
  const url = absoluteLink(appUrl, n.link);
  return [`<b>${escapeHtml(n.title)}</b>`, n.body ? escapeHtml(n.body) : "", url ? `<a href="${escapeHtml(url)}">Открыть в системе</a>` : ""].filter(Boolean).join("\n").slice(0, 4000);
}

export const MAX_DELIVERY_ATTEMPTS = 5;

export interface DeliveryPlan {
  email: boolean;
  telegram: boolean;
}

/** Куда доставлять уведомление пользователю: канал включён у пользователя, настроен в системе и ещё не отправлен. */
export function deliveryChannels(
  user: { notifyEmail: boolean; notifyTelegram: boolean; telegramChatId: string | null; isActive: boolean },
  settings: ChannelSettings,
  sent: { emailSentAt: Date | null; telegramSentAt: Date | null } = { emailSentAt: null, telegramSentAt: null },
): DeliveryPlan {
  const smtpReady = settings.smtp.enabled && Boolean(settings.smtp.host);
  const telegramReady = settings.telegram.enabled && Boolean(settings.telegram.tokenEnc);
  return {
    email: user.isActive && user.notifyEmail && smtpReady && !sent.emailSentAt,
    telegram: user.isActive && user.notifyTelegram && Boolean(user.telegramChatId) && telegramReady && !sent.telegramSentAt,
  };
}

/** Состояние после попытки: всё ушло — sent; нет — pending до MAX_DELIVERY_ATTEMPTS попыток, затем failed. */
export function stateAfterAttempt(attempts: number, allSent: boolean): "sent" | "pending" | "failed" {
  if (allSent) return "sent";
  return attempts >= MAX_DELIVERY_ATTEMPTS ? "failed" : "pending";
}

/** Код привязки Telegram: 6 знаков без похожих букв и цифр. */
export function makeLinkCode(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
}

/** Чат, из которого боту прислали код привязки (в тексте сообщения или в /start КОД). */
export function findChatByCode(updates: Array<{ message?: { text?: string; chat?: { id?: number | string } } }>, code: string): string | null {
  for (const u of [...updates].reverse()) {
    const text = (u.message?.text ?? "").toUpperCase();
    if (text.includes(code.toUpperCase()) && u.message?.chat?.id !== undefined) return String(u.message.chat.id);
  }
  return null;
}
