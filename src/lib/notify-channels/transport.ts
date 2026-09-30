import nodemailer from "nodemailer";
import type { SmtpSettings } from "./compose";

/** Отправка письма через SMTP организации. Ошибка — исключение с текстом сервера. */
export async function sendEmail(settings: SmtpSettings, password: string | null, message: { to: string; subject: string; text: string; html: string }) {
  const transport = nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === "ssl",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    auth: settings.user ? { user: settings.user, pass: password ?? "" } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  try {
    await transport.sendMail({ from: settings.from, ...message });
  } finally {
    transport.close();
  }
}

export interface TelegramUpdate {
  message?: { text?: string; chat?: { id?: number | string } };
}

/** Вызов Bot API Telegram. fetchImpl подменяется в тестах. */
export async function telegramCall<T>(token: string, method: string, body: Record<string, unknown> = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new Error(timeout ? "Telegram не ответил за 15 секунд" : `Telegram недоступен: ${error instanceof Error ? error.message : "ошибка сети"}`);
  }
  const data = (await response.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (response.status === 401 || response.status === 404) throw new Error("Telegram отклонил токен бота — проверьте его в настройках каналов");
  if (response.status === 403) throw new Error("Пользователь остановил бота или не начинал с ним диалог");
  if (!response.ok || !data.ok) throw new Error(`Telegram: ${data.description ?? `ошибка HTTP ${response.status}`}`);
  return data.result as T;
}
