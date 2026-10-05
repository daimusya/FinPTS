import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { decryptSecret, maskSecret } from "@/lib/crypto/secret-box";
import { loadChannelSettings } from "@/lib/notify-channels/deliver";
import { retryDeliveryAction, saveChannelSettingsAction, sendTestEmailAction, sendTestTelegramAction } from "./actions";
import { singleParams } from "@/lib/query-params";

const dateTime = (d: Date) => d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });

export default async function NotificationChannelsPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.ADMIN_FULL)) {
    return (
      <div className="page">
        <div className="card">Раздел доступен только полному администратору.</div>
      </div>
    );
  }
  const sp = singleParams(await searchParams);
  const settings = await loadChannelSettings();
  const dayAgo = new Date();
  dayAgo.setUTCDate(dayAgo.getUTCDate() - 1);
  const [pending, failed, sentDay, subscribers, recentFailed] = await Promise.all([
    prisma.notification.count({ where: { deliveryState: "pending" } }),
    prisma.notification.count({ where: { deliveryState: "failed" } }),
    prisma.notification.count({ where: { deliveryState: "sent", deliveredAt: { gte: dayAgo } } }),
    prisma.user.findMany({ where: { isActive: true, OR: [{ notifyEmail: true }, { notifyTelegram: true }] }, select: { fullName: true, notifyEmail: true, notifyTelegram: true, telegramChatId: true } }),
    prisma.notification.findMany({ where: { deliveryState: "failed" }, orderBy: { createdAt: "desc" }, take: 5, include: { user: { select: { fullName: true } } } }),
  ]);
  const tokenMask = settings.telegram.tokenEnc ? maskSecret(decryptSecret(settings.telegram.tokenEnc)) : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Каналы уведомлений</h1>
          <p>
            Уведомления из колокольчика (заявки на оплату, мониторинг) можно дублировать на почту и в Telegram. Здесь — общие
            настройки: почтовый сервер организации и бот. Каждый пользователь сам включает каналы на странице{" "}
            <Link href="/notifications">«Уведомления»</Link>. Пароль и токен хранятся зашифрованными и не показываются.
          </p>
        </div>
      </div>

      {sp.error ? <p className="form-error" style={{ marginBottom: 14 }}>{sp.error}</p> : null}
      {sp.notice ? <p className="form-success" style={{ marginBottom: 14 }}>{sp.notice}</p> : null}

      <form action={saveChannelSettingsAction} className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <label className="field">
          <span>Адрес системы (для ссылок в письмах и сообщениях) *</span>
          <input type="url" name="appUrl" id="ch-app-url" defaultValue={settings.appUrl} required placeholder="https://fin.example.ru" />
        </label>

        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "18px 0 8px" }}>Почта (SMTP)</h2>
        <div className="form-grid">
          <label className="field">
            <span>Сервер</span>
            <input type="text" name="smtpHost" id="ch-smtp-host" defaultValue={settings.smtp.host} placeholder="smtp.yandex.ru" />
          </label>
          <label className="field">
            <span>Порт</span>
            <input type="number" name="smtpPort" id="ch-smtp-port" defaultValue={settings.smtp.port} min={1} max={65535} />
          </label>
          <label className="field">
            <span>Шифрование</span>
            <select name="smtpSecurity" id="ch-smtp-security" defaultValue={settings.smtp.security}>
              <option value="ssl">SSL/TLS (обычно порт 465)</option>
              <option value="starttls">STARTTLS (обычно порт 587)</option>
              <option value="none">Без шифрования (только внутренняя сеть)</option>
            </select>
          </label>
          <label className="field">
            <span>Логин</span>
            <input type="text" name="smtpUser" id="ch-smtp-user" defaultValue={settings.smtp.user} autoComplete="off" placeholder="fin@example.ru" />
          </label>
          <label className="field">
            <span>{settings.smtp.passwordEnc ? "Пароль (пусто — не менять)" : "Пароль"}</span>
            <input type="password" name="smtpPassword" id="ch-smtp-password" autoComplete="new-password" placeholder={settings.smtp.passwordEnc ? "••••••••" : "пароль приложения почты"} />
          </label>
          <label className="field">
            <span>Отправитель</span>
            <input type="text" name="smtpFrom" id="ch-smtp-from" defaultValue={settings.smtp.from} placeholder="ПРОМТЕХНОСФЕРА <fin@example.ru>" />
          </label>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" name="smtpEnabled" id="ch-smtp-enabled" defaultChecked={settings.smtp.enabled} />
          Отправлять уведомления на почту
        </label>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          У Яндекса, Mail.ru и Gmail нужен «пароль приложения» из настроек безопасности ящика, а не обычный пароль.
        </p>

        <h2 style={{ fontSize: 14, fontWeight: 700, margin: "18px 0 8px" }}>Telegram</h2>
        {tokenMask ? (
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 8 }}>
            Бот {settings.telegram.botUsername ? `@${settings.telegram.botUsername}` : ""}, токен <span className="mono">{tokenMask}</span>
          </p>
        ) : null}
        <label className="field">
          <span>{tokenMask ? "Новый токен бота (пусто — не менять)" : "Токен бота"}</span>
          <input type="password" name="telegramToken" id="ch-tg-token" autoComplete="off" placeholder="123456789:AAE… — выдаёт @BotFather" />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
          <input type="checkbox" name="telegramEnabled" id="ch-tg-enabled" defaultChecked={settings.telegram.enabled} />
          Отправлять уведомления в Telegram
        </label>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
          Создайте бота у @BotFather (команда /newbot) и вставьте токен — он проверяется сразу. Затем каждый пользователь привязывает
          свой чат на странице «Уведомления».
        </p>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary">
            Сохранить
          </button>
        </div>
      </form>

      <div className="card" style={{ maxWidth: 760, marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Проверка и очередь</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <form action={sendTestEmailAction}>
            <button type="submit" className="btn btn-secondary" disabled={!settings.smtp.host}>
              Тестовое письмо себе
            </button>
          </form>
          <form action={sendTestTelegramAction}>
            <button type="submit" className="btn btn-secondary" disabled={!settings.telegram.tokenEnc}>
              Тестовое сообщение в Telegram
            </button>
          </form>
          <form action={retryDeliveryAction}>
            <button type="submit" className="btn btn-ghost" disabled={pending + failed === 0}>
              Повторить неотправленные
            </button>
          </form>
        </div>
        <p style={{ fontSize: 13 }}>
          За сутки доставлено: {sentDay}. Ждут отправки: {pending}. Не удалось после 5 попыток: {failed}. Повтор — каждые 30 минут вместе
          с загрузкой выписок.
        </p>
        {recentFailed.length > 0 ? (
          <ul style={{ paddingLeft: 18, fontSize: 12, marginTop: 6 }}>
            {recentFailed.map((n) => (
              <li key={n.id}>
                {dateTime(n.createdAt)} · {n.user.fullName} · «{n.title}» — <span className="text-muted">{n.deliveryError}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Каналы включили: {subscribers.length === 0 ? "пока никто" : subscribers
            .map((u) => `${u.fullName} (${[u.notifyEmail ? "почта" : null, u.notifyTelegram ? (u.telegramChatId ? "Telegram" : "Telegram не привязан") : null].filter(Boolean).join(", ")})`)
            .join("; ")}
          .
        </p>
      </div>
    </div>
  );
}
