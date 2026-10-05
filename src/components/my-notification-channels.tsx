import { prisma } from "@/lib/db";
import { loadChannelSettings } from "@/lib/notify-channels/deliver";
import {
  checkTelegramLinkAction,
  saveMyChannelsAction,
  startTelegramLinkAction,
  unlinkTelegramAction,
} from "@/app/(app)/notifications/actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

/** Страница «Уведомления»: куда ещё дублировать уведомления этому пользователю. */
export async function MyNotificationChannels({ userId, error, notice }: { userId: string; error?: string; notice?: string }) {
  const [settings, user] = await Promise.all([loadChannelSettings(), prisma.user.findUniqueOrThrow({ where: { id: userId } })]);
  const emailReady = settings.smtp.enabled && Boolean(settings.smtp.host);
  const telegramReady = settings.telegram.enabled && Boolean(settings.telegram.tokenEnc);
  if (!emailReady && !telegramReady && !user.notifyEmail && !user.notifyTelegram) {
    return (
      <div className="card" id="channels" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Почта и Telegram</h2>
        <p className="text-muted">
          Дублирование уведомлений на почту и в Telegram пока не настроено — это делает администратор в разделе «Каналы
          уведомлений».
        </p>
      </div>
    );
  }
  const bot = settings.telegram.botUsername ? `@${settings.telegram.botUsername}` : "бот системы";
  return (
    <div className="card" id="channels" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Куда ещё присылать</h2>
      {error ? <p className="form-error" style={{ marginBottom: 8 }}>{error}</p> : null}
      {notice ? <p className="form-success" style={{ marginBottom: 8 }}>{notice}</p> : null}
      <form action={saveMyChannelsAction} style={{ display: "grid", gap: 8, fontSize: 13 }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="notifyEmail" id="my-notify-email" defaultChecked={user.notifyEmail} disabled={!emailReady && !user.notifyEmail} />
          На почту {user.email}
          {!emailReady ? <span className="text-muted">— почта не настроена</span> : null}
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            name="notifyTelegram"
            id="my-notify-telegram"
            defaultChecked={user.notifyTelegram}
            disabled={!user.telegramChatId && !user.notifyTelegram}
          />
          В Telegram {user.telegramChatId ? "(привязан)" : <span className="text-muted">— сначала привяжите ниже</span>}
        </label>
        <div>
          <button type="submit" className="btn btn-secondary btn-sm">
            Сохранить
          </button>
        </div>
      </form>

      {telegramReady ? (
        <div style={{ marginTop: 14, fontSize: 13 }}>
          {user.telegramChatId ? (
            <form action={unlinkTelegramAction}>
              <ConfirmSubmitButton className="btn btn-ghost btn-sm" message="Отвязать Telegram? Уведомления туда приходить перестанут, для повторной привязки понадобится новый код.">
                Отвязать Telegram
              </ConfirmSubmitButton>
            </form>
          ) : user.telegramLinkCode ? (
            <div style={{ display: "grid", gap: 8 }}>
              <p>
                Откройте в Telegram {bot}, нажмите «Старт» и отправьте код <strong className="mono">{user.telegramLinkCode}</strong>.
                Затем нажмите «Проверить».
              </p>
              <div style={{ display: "flex", gap: 8 }}>
                <form action={checkTelegramLinkAction}>
                  <button type="submit" className="btn btn-primary btn-sm">
                    Проверить
                  </button>
                </form>
                <form action={startTelegramLinkAction}>
                  <button type="submit" className="btn btn-ghost btn-sm">
                    Новый код
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <form action={startTelegramLinkAction}>
              <button type="submit" className="btn btn-secondary btn-sm">
                Привязать Telegram
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
