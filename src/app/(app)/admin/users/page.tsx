import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { readFlash } from "@/lib/flash";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { FlashConsumed } from "@/components/flash-consumed";
import { endUserSessionsAction, resetPasswordAction, resetUserMfaAction, setMfaPolicyAction } from "./actions";
import { singleParams } from "@/lib/query-params";
import { MFA_POLICY_LABELS, type MfaPolicy } from "@/lib/mfa/policy";
import { getMfaPolicy } from "@/lib/mfa/settings";
import { SubmitButton } from "@/components/submit-button";

const loginTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const { notice, error } = singleParams(await searchParams);
  const session = await getSession();
  const flash = await readFlash("tempPassword");
  const [forEmail, tempPassword] = flash ? flash.split("\n") : [null, null];
  if (!session || !hasPermission(session, PERMISSIONS.USERS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления пользователями.</div>
      </div>
    );
  }

  const [users, logins] = await Promise.all([
    prisma.user.findMany({
      orderBy: { fullName: "asc" },
      include: { roles: { include: { role: true } } },
    }),
    prisma.auditLog.groupBy({ by: ["userId"], where: { entityType: "session", action: "login" }, _max: { createdAt: true } }),
  ]);
  const lastLogin = new Map(logins.map((l) => [l.userId, l._max.createdAt]));
  const mfaPolicy = await getMfaPolicy();
  const canSetPolicy = hasPermission(session, PERMISSIONS.ADMIN_FULL);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Пользователи</h1>
          <p>Учётные записи и назначенные роли.</p>
        </div>
        <Link href="/admin/users/new" className="btn btn-primary">
          Добавить пользователя
        </Link>
      </div>

      {error ? (
        <p className="form-error" style={{ marginBottom: 14 }}>
          {error}
        </p>
      ) : null}
      <div className="card" style={{ marginBottom: 16 }}>
        {canSetPolicy ? (
          <form action={setMfaPolicyAction} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field" style={{ minWidth: 320 }}>
              <span>Вход с кодом из приложения на телефоне</span>
              <select name="policy" id="mfa-policy" defaultValue={mfaPolicy}>
                {(Object.keys(MFA_POLICY_LABELS) as MfaPolicy[]).map((p) => (
                  <option key={p} value={p}>
                    {MFA_POLICY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton className="btn btn-secondary">Сохранить</SubmitButton>
          </form>
        ) : (
          <p style={{ margin: 0 }}>Вход с кодом из приложения: {MFA_POLICY_LABELS[mfaPolicy]}.</p>
        )}
        <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          С обязательным входом пользователь без подключённого кода при следующем входе сначала подключит приложение-генератор
          (Яндекс Ключ, Google Authenticator и т. п.). Каждый подключает и управляет кодом на своей странице «Вход с кодом».
        </p>
      </div>

      {notice ? (
        <p className="form-success" style={{ marginBottom: 14 }}>
          {notice}
        </p>
      ) : null}

      {tempPassword ? (
        <div className="card" style={{ marginBottom: 16, borderColor: "var(--color-orange)" }}>
          <p className="form-success">
            Временный пароль для {forEmail}: <strong className="mono">{tempPassword}</strong>
          </p>
          <p className="text-muted">Сообщите пароль пользователю лично. Он не будет показан повторно.</p>
          <FlashConsumed name="tempPassword" />
        </div>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ФИО</th>
              <th>Email</th>
              <th>Роли</th>
              <th>Статус</th>
              <th>Последний вход</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.fullName}</td>
                <td className="mono">{user.email}</td>
                <td>
                  <div className="tag-list">
                    {user.roles.map((r) => (
                      <span className="badge badge-orange" key={r.roleId}>
                        {r.role.name}
                      </span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`badge ${user.isActive ? "badge-active" : "badge-archived"}`}>
                    {user.isActive ? "Активен" : "Отключён"}
                  </span>
                  {user.totpEnabledAt ? (
                    <span className="badge badge-active" style={{ marginLeft: 6 }} title="При входе после пароля нужен код из приложения">
                      Вход с кодом
                    </span>
                  ) : null}
                  {user.mustChangePassword ? (
                    <span className="badge badge-orange" style={{ marginLeft: 6 }} title="Пароль выдан администратором; пользователь сменит его при входе">
                      Временный пароль
                    </span>
                  ) : null}
                </td>
                <td className="text-muted">{lastLogin.get(user.id) ? loginTime.format(lastLogin.get(user.id)!) : "не входил"}</td>
                <td>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <Link href={`/admin/users/${user.id}/edit`} className="btn btn-ghost btn-sm">
                      Изменить
                    </Link>
                    {user.id === session.userId ? (
                      <Link href="/account/password" className="btn btn-ghost btn-sm">
                        Сменить пароль
                      </Link>
                    ) : (
                      <form action={endUserSessionsAction.bind(null, user.id)}>
                        <ConfirmSubmitButton
                          className="btn btn-ghost btn-sm"
                          message={`Завершить все сеансы пользователя ${user.fullName}? Пароль не изменится, войти нужно будет заново.`}
                        >
                          Завершить сеансы
                        </ConfirmSubmitButton>
                      </form>
                    )}
                    {user.totpEnabledAt && user.id !== session.userId ? (
                      <form action={resetUserMfaAction.bind(null, user.id)}>
                        <ConfirmSubmitButton
                          className="btn btn-ghost btn-sm"
                          message={`Сбросить вход с кодом у пользователя ${user.fullName}? Делайте это, только если он потерял или сменил телефон и попросил сам. Его сеансы завершатся.`}
                        >
                          Сбросить вход с кодом
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                    {user.id === session.userId ? null : (
                      <form action={resetPasswordAction.bind(null, user.id)}>
                        <ConfirmSubmitButton
                          className="btn btn-ghost btn-sm"
                          message={`Сбросить пароль пользователя ${user.fullName}? Текущий пароль перестанет действовать, а сеансы на всех устройствах завершатся.`}
                        >
                          Сбросить пароль
                        </ConfirmSubmitButton>
                      </form>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
