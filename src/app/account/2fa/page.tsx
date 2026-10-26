import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { singleParams } from "@/lib/query-params";
import { readFlash } from "@/lib/flash";
import { tryDecryptSecret } from "@/lib/crypto/secret-box";
import { formatSecretForHumans, otpauthUrl } from "@/lib/mfa/totp";
import { FlashConsumed } from "@/components/flash-consumed";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { mfaRequiredFor } from "@/lib/mfa/policy";
import { getMfaPolicy } from "@/lib/mfa/settings";
import { cancelMfaSetupAction, confirmMfaSetupAction, disableMfaAction, regenerateRecoveryCodesAction, startMfaSetupAction } from "./actions";

const ISSUER = "ПРОМТЕХНОСФЕРА";

/** Вход с кодом из приложения на телефоне: подключение, резервные коды, отключение. */
export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; enabled?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mustChangePassword) redirect("/account/password");
  const { error, notice, enabled } = singleParams(await searchParams);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const required = mfaRequiredFor(await getMfaPolicy(), session.permissions);
  const recoveryCodes = enabled ? await readFlash("recoveryCodes") : null;

  // An unreadable pending secret (AUTH_SECRET changed) simply means: start the connection again.
  const pendingSecret = !user.totpEnabledAt && user.totpPendingSecretEnc ? tryDecryptSecret(user.totpPendingSecretEnc) : null;
  const qr = pendingSecret
    ? `data:image/svg+xml;utf8,${encodeURIComponent(
        await QRCode.toString(otpauthUrl({ issuer: ISSUER, account: user.email, secret: pendingSecret }), { type: "svg", margin: 1, errorCorrectionLevel: "M" }),
      )}`
    : null;

  return (
    <div className="login-page">
      <div className="login-card" style={{ maxWidth: 480 }}>
        <div className="login-brand">
          <span className="login-brand-mark">ПТ</span>
          <div>
            <h1>Вход с кодом</h1>
            <p>{session.fullName}</p>
          </div>
        </div>

        {session.mustSetupMfa ? (
          <p className="text-muted" style={{ marginBottom: 12 }}>
            Администратор включил обязательный вход с кодом. Чтобы продолжить работу, подключите приложение-генератор кодов на
            телефоне — это займёт пару минут.
          </p>
        ) : null}
        {error ? <p className="form-error" style={{ marginBottom: 12 }}>{error}</p> : null}
        {notice ? <p className="form-success" style={{ marginBottom: 12 }}>{notice}</p> : null}

        {recoveryCodes ? (
          <div className="card" style={{ marginBottom: 14, borderColor: "var(--color-orange)" }}>
            <FlashConsumed name="recoveryCodes" />
            <p style={{ margin: "0 0 8px" }}>
              <strong>Резервные коды — сохраните их сейчас.</strong> Они показываются один раз. Каждый код позволяет войти один раз,
              если телефона нет под рукой или он потерян. Запишите их или сохраните в надёжном месте (не в этом же телефоне).
            </p>
            <div className="mono" style={{ display: "grid", gridTemplateColumns: "repeat(2, max-content)", gap: "4px 24px", fontSize: 15 }}>
              {recoveryCodes.split(" ").map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
        ) : null}

        {user.totpEnabledAt ? (
          <>
            <p style={{ marginBottom: 12 }}>
              <span className="badge badge-active">Включён</span> с{" "}
              {user.totpEnabledAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}. При входе после пароля система
              спрашивает 6-значный код из приложения. Резервных кодов осталось: {user.totpRecoveryHashes.length}.
            </p>
            <form action={regenerateRecoveryCodesAction} style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              <label className="field">
                <span>Новые резервные коды (старые перестанут действовать) — текущий код из приложения</span>
                <input type="text" name="code" id="regen-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
              </label>
              <SubmitButton className="btn btn-secondary">Получить новые резервные коды</SubmitButton>
            </form>
            {required ? (
              <p className="text-muted" style={{ fontSize: 12 }}>
                Для вас вход с кодом обязателен — отключить его нельзя. Сменили телефон — попросите администратора сбросить вход с
                кодом и подключите заново.
              </p>
            ) : (
              <form action={disableMfaAction} style={{ display: "grid", gap: 8, paddingTop: 12, borderTop: "1px solid var(--color-graphite-150)" }}>
                <label className="field">
                  <span>Отключить вход с кодом — код из приложения или резервный</span>
                  <input type="text" name="code" id="disable-code" autoComplete="one-time-code" maxLength={12} required />
                </label>
                <ConfirmSubmitButton className="btn btn-ghost" message="Отключить вход с кодом? Для входа снова будет достаточно одного пароля.">
                  Отключить
                </ConfirmSubmitButton>
              </form>
            )}
          </>
        ) : pendingSecret && qr ? (
          <>
            <ol style={{ paddingLeft: 18, margin: "0 0 12px", display: "grid", gap: 6, fontSize: 13 }}>
              <li>Установите на телефон приложение-генератор кодов: Яндекс Ключ, Google Authenticator, Microsoft Authenticator или другое.</li>
              <li>В приложении выберите «Добавить» → «Сканировать QR-код» и наведите камеру на код ниже.</li>
              <li>Введите 6 цифр, которые покажет приложение.</li>
            </ol>
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: image, nothing to optimize */}
            <img src={qr} alt="QR-код для приложения-генератора кодов" width={200} height={200} style={{ display: "block", margin: "0 auto 8px", background: "#fff" }} />
            <p className="text-muted" style={{ fontSize: 12, textAlign: "center", marginBottom: 12 }}>
              Не сканируется? Введите ключ вручную: <span className="mono">{formatSecretForHumans(pendingSecret)}</span>
            </p>
            <form action={confirmMfaSetupAction} style={{ display: "grid", gap: 8 }}>
              <label className="field">
                <span>Код из приложения</span>
                <input type="text" name="code" id="setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus />
              </label>
              <SubmitButton className="btn btn-primary">Подтвердить и включить</SubmitButton>
            </form>
            <form action={cancelMfaSetupAction} style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-ghost btn-sm">
                Отменить подключение
              </button>
            </form>
          </>
        ) : (
          <>
            <p style={{ marginBottom: 12 }}>
              После пароля система будет спрашивать 6-значный код из приложения на вашем телефоне. Даже если пароль узнают, без
              телефона войти не получится.
            </p>
            <form action={startMfaSetupAction}>
              <SubmitButton className="btn btn-primary">Подключить вход с кодом</SubmitButton>
            </form>
          </>
        )}

        {!session.mustSetupMfa ? (
          <p style={{ marginTop: 14, fontSize: 13 }}>
            <Link href="/dashboard">← Вернуться в систему</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
