import { describe, expect, it, vi } from "vitest";
import {
  composeEmail,
  composeTelegram,
  DEFAULT_SETTINGS,
  deliveryChannels,
  findChatByCode,
  makeLinkCode,
  normalizeAppUrl,
  readSettings,
  stateAfterAttempt,
  validateBotToken,
  validateSmtp,
  type ChannelSettings,
} from "./compose";
import { telegramCall } from "./transport";
import { checkDelivery } from "@/lib/monitoring/checks";

describe("settings", () => {
  it("normalizes the system address", () => {
    expect(normalizeAppUrl(" https://fin.example.ru/ ")).toEqual({ value: "https://fin.example.ru" });
    expect(normalizeAppUrl("http://localhost:3000")).toEqual({ value: "http://localhost:3000" });
    expect(normalizeAppUrl("fin.example.ru")).toHaveProperty("error");
    expect(normalizeAppUrl("ftp://x.ru")).toHaveProperty("error");
  });

  it("checks the SMTP form only when mail is used", () => {
    const form = { enabled: true, host: "smtp.yandex.ru", port: "465", security: "ssl", user: "fin@example.ru", from: "ПРОМТЕХНОСФЕРА <fin@example.ru>" };
    expect(validateSmtp(form)).toEqual({ value: { enabled: true, host: "smtp.yandex.ru", port: 465, security: "ssl", user: "fin@example.ru", from: "ПРОМТЕХНОСФЕРА <fin@example.ru>" } });
    expect(validateSmtp({ ...form, host: "smtp yandex" })).toEqual({ error: "Сервер почты — имя вида smtp.yandex.ru" });
    expect(validateSmtp({ ...form, port: "70000" })).toHaveProperty("error");
    expect(validateSmtp({ ...form, from: "не адрес" })).toHaveProperty("error");
    expect(validateSmtp({ ...form, user: "a\r\nBcc: x@y.ru" })).toEqual({ error: "В полях не должно быть переносов строк" });
    expect(validateSmtp({ enabled: false, host: "", port: "", security: "ssl", user: "", from: "" })).toHaveProperty("value");
  });

  it("recognizes a bot token and fills missing settings with defaults", () => {
    expect(validateBotToken(" 123456789:AAEabcdefghijklmnopqrstuvwxyz_0123 ")).toEqual({ value: "123456789:AAEabcdefghijklmnopqrstuvwxyz_0123" });
    expect(validateBotToken("мой бот")).toHaveProperty("error");
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ smtp: { host: "smtp.mail.ru" } }).smtp).toMatchObject({ host: "smtp.mail.ru", port: 465, enabled: false });
  });
});

describe("messages", () => {
  const n = { title: "Заявка согласована", body: "Заявка на 120 000,00 ₽ <срочно> & важно", link: "/payment-requests/abc" };

  it("builds an e-mail with an absolute link and escaped HTML", () => {
    const mail = composeEmail(n, "https://fin.example.ru");
    expect(mail.subject).toBe("Заявка согласована");
    expect(mail.text).toContain("Открыть: https://fin.example.ru/payment-requests/abc");
    expect(mail.html).toContain("&lt;срочно&gt; &amp; важно");
    expect(mail.html).toContain('href="https://fin.example.ru/payment-requests/abc"');
    expect(composeEmail({ ...n, title: "Строка\r\nBcc: x@y.ru" }, "https://a.ru").subject).toBe("Строка Bcc: x@y.ru");
  });

  it("builds a Telegram message and ignores links outside the system", () => {
    expect(composeTelegram(n, "https://fin.example.ru")).toBe(
      '<b>Заявка согласована</b>\nЗаявка на 120 000,00 ₽ &lt;срочно&gt; &amp; важно\n<a href="https://fin.example.ru/payment-requests/abc">Открыть в системе</a>',
    );
    expect(composeTelegram({ ...n, link: "https://evil.example" }, "https://fin.example.ru")).not.toContain("evil");
  });
});

describe("delivery", () => {
  const settings: ChannelSettings = {
    appUrl: "https://fin.example.ru",
    smtp: { ...DEFAULT_SETTINGS.smtp, enabled: true, host: "smtp.yandex.ru" },
    telegram: { enabled: true, tokenEnc: "x", botUsername: "fin_bot" },
  };
  const user = { notifyEmail: true, notifyTelegram: true, telegramChatId: "42", isActive: true };

  it("uses the channels the user switched on and the system has configured", () => {
    expect(deliveryChannels(user, settings)).toEqual({ email: true, telegram: true });
    expect(deliveryChannels({ ...user, telegramChatId: null }, settings)).toEqual({ email: true, telegram: false });
    expect(deliveryChannels(user, { ...settings, smtp: { ...settings.smtp, enabled: false } })).toEqual({ email: false, telegram: true });
    expect(deliveryChannels({ ...user, isActive: false }, settings)).toEqual({ email: false, telegram: false });
  });

  it("does not resend a channel that already went through", () => {
    expect(deliveryChannels(user, settings, { emailSentAt: new Date(), telegramSentAt: null })).toEqual({ email: false, telegram: true });
  });

  it("retries up to five times, then gives up", () => {
    expect(stateAfterAttempt(1, true)).toBe("sent");
    expect(stateAfterAttempt(1, false)).toBe("pending");
    expect(stateAfterAttempt(5, false)).toBe("failed");
  });
});

describe("Telegram linking", () => {
  it("makes readable codes and finds the chat that sent one", () => {
    const code = makeLinkCode(() => 0);
    expect(code).toBe("AAAAAA");
    expect(makeLinkCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const updates = [
      { message: { text: "привет", chat: { id: 1 } } },
      { message: { text: "/start k7m2qp", chat: { id: 777 } } },
    ];
    expect(findChatByCode(updates, "K7M2QP")).toBe("777");
    expect(findChatByCode(updates, "ZZZZZZ")).toBeNull();
  });

  it("turns Bot API errors into plain messages", async () => {
    const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    await expect(telegramCall("t", "getMe", {}, reply(401, { ok: false }) as unknown as typeof fetch)).rejects.toThrow("Telegram отклонил токен бота");
    await expect(telegramCall("t", "sendMessage", {}, reply(403, { ok: false }) as unknown as typeof fetch)).rejects.toThrow("остановил бота");
    await expect(telegramCall<{ username: string }>("t", "getMe", {}, reply(200, { ok: true, result: { username: "fin_bot" } }) as unknown as typeof fetch)).resolves.toEqual({
      username: "fin_bot",
    });
    const slow = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    await expect(telegramCall("t", "getMe", {}, slow as unknown as typeof fetch)).rejects.toThrow("не ответил за 15 секунд");
  });
});

describe("monitoring of delivery", () => {
  it("warns about failed and stuck notifications", () => {
    expect(checkDelivery({ failedLastDay: 0, stuck: 0, lastError: null }).status).toBe("ok");
    expect(checkDelivery({ failedLastDay: 2, stuck: 0, lastError: "почта: 535 auth failed" }).message).toBe("За сутки не доставлено 2: почта: 535 auth failed");
    expect(checkDelivery({ failedLastDay: 0, stuck: 3, lastError: null }).message).toBe("3 ждут отправки дольше часа");
  });
});
