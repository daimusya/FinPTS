import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { changeOwnPasswordAction, endOtherSessionsAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";

/** Смена собственного пароля; при пароле, выданном администратором, — обязательна. */
export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; sessions?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { error, done, sessions } = singleParams(await searchParams);
  const devices = await prisma.knownDevice.findMany({ where: { userId: session.userId }, orderBy: { lastSeenAt: "desc" }, take: 20 });

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-brand-mark">ПТ</span>
          <div>
            <h1>Смена пароля</h1>
            <p>{session.fullName}</p>
          </div>
        </div>

        {session.mustChangePassword ? (
          <p className="text-muted" style={{ marginBottom: 12 }}>
            Пароль выдан администратором. Чтобы продолжить работу, придумайте свой — его будете знать только вы.
          </p>
        ) : null}
        {done ? (
          <p className="form-success" style={{ marginBottom: 12 }}>
            Пароль изменён. На других устройствах нужно будет войти заново.
          </p>
        ) : null}
        {sessions ? (
          <p className="form-success" style={{ marginBottom: 12 }}>
            Сеансы на других устройствах завершены. Здесь вы остаётесь в системе.
          </p>
        ) : null}
        {error ? (
          <p className="form-error" style={{ marginBottom: 12 }}>
            {error}
          </p>
        ) : null}

        <form action={changeOwnPasswordAction} style={{ display: "grid", gap: 12 }}>
          <label className="field">
            <span>Текущий пароль</span>
            <input type="password" name="currentPassword" id="current-password" autoComplete="current-password" required />
          </label>
          <label className="field">
            <span>Новый пароль</span>
            <input type="password" name="newPassword" id="new-password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </label>
          <label className="field">
            <span>Повторите новый пароль</span>
            <input type="password" name="repeatPassword" id="repeat-password" autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} required />
          </label>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            Не короче {MIN_PASSWORD_LENGTH} символов, буквы и цифры, без вашей почты. После смены на других устройствах нужно будет
            войти заново.
          </p>
          <SubmitButton className="btn btn-primary">
            Сменить пароль
          </SubmitButton>
        </form>

        {!session.mustChangePassword ? (
          <form action={endOtherSessionsAction} style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--color-graphite-150)" }}>
            <p className="text-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
              Входили с чужого компьютера или потеряли устройство? Завершите сеансы — там придётся войти заново.
            </p>
            <ConfirmSubmitButton className="btn btn-secondary" message="Завершить сеансы на всех других устройствах? Здесь вы останетесь в системе.">
              Завершить сеансы на других устройствах
            </ConfirmSubmitButton>
          </form>
        ) : null}

        {!session.mustChangePassword && devices.length > 0 ? (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--color-graphite-150)" }}>
            <p className="text-muted" style={{ fontSize: 12, margin: "0 0 8px" }}>
              Устройства, с которых вы входили. Незнакомое — смените пароль и завершите сеансы на других устройствах.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, display: "grid", gap: 4 }}>
              {devices.map((d) => (
                <li key={d.id}>
                  {d.label}
                  {d.lastIp ? <span className="text-muted"> · {d.lastIp}</span> : null}
                  <span className="text-muted">
                    {" "}
                    · последний вход {d.lastSeenAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!session.mustChangePassword ? (
          <p style={{ marginTop: 14, fontSize: 13 }}>
            <Link href="/dashboard">← Вернуться в систему</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
