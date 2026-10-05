import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { BANK_PROVIDER_LABELS, BANK_PROVIDERS, describeCredentials, isBankProvider } from "@/lib/bank-api/core";
import {
  addBankConnectionAction,
  removeBankConnectionAction,
  replaceBankCredentialsAction,
  syncAllBankConnectionsAction,
  syncBankConnectionAction,
  toggleBankConnectionAction,
} from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { singleParams } from "@/lib/query-params";

const dateTime = (d: Date | null) => (d ? d.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" }) : "—");

export default async function BankApiPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; replace?: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.INTEGRATIONS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления интеграциями.</div>
      </div>
    );
  }
  const sp = singleParams(await searchParams);
  const [connections, accounts] = await Promise.all([
    prisma.bankConnection.findMany({ include: { bankAccount: { include: { organization: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.bankAccount.findMany({ where: { isArchived: false, apiConnection: null }, include: { organization: true }, orderBy: { bankName: "asc" } }),
  ]);
  const today = new Date();
  const defaultFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 30)).toISOString().slice(0, 10);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Банки: загрузка выписки по API</h1>
          <p>
            Операции по подключённым счетам загружаются в «Банк и касса» сами — без файлов выписки: с контрагентами по ИНН,
            статьями и разрезами по правилам классификации и защитой от дублей (операции, уже загруженные файлом, не
            задваиваются). Каждая загрузка берёт период с последней успешной минус 3 дня — банки проводят операции и задним
            числом. Реквизиты подключения хранятся зашифрованными и на экран не выводятся; нужны права только на чтение
            выписки.
          </p>
        </div>
        {connections.length > 0 ? (
          <form action={syncAllBankConnectionsAction}>
            <button type="submit" className="btn btn-secondary">
              Загрузить все счета сейчас
            </button>
          </form>
        ) : null}
      </div>

      {sp.error ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error">{sp.error}</p>
        </div>
      ) : null}
      {sp.notice ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">{sp.notice}</p>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Подключённые счета</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Счёт</th>
                <th>Банк</th>
                <th>Реквизиты</th>
                <th>Загрузка с</th>
                <th>Последняя загрузка</th>
                <th>Результат</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => {
                const provider = isBankProvider(c.provider) ? c.provider : null;
                const replacing = sp.replace === c.id;
                return (
                  <tr key={c.id} className={replacing ? "row-editing" : undefined}>
                    <td>
                      {c.bankAccount.bankName} {c.bankAccount.accountNumber}
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {c.bankAccount.organization.shortName || c.bankAccount.organization.name}
                      </div>
                    </td>
                    <td>
                      {provider ? BANK_PROVIDER_LABELS[provider] : c.provider}
                      {!c.isActive ? <div className="badge">выключено</div> : null}
                    </td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{describeCredentials(c.credentialsEncrypted)}</td>
                    <td>{c.syncFrom.toLocaleDateString("ru-RU", { timeZone: "UTC" })}</td>
                    <td>
                      {dateTime(c.lastSyncAt)}
                      {c.lastSuccessAt && c.lastSuccessAt.getTime() !== c.lastSyncAt?.getTime() ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>успешная: {dateTime(c.lastSuccessAt)}</div>
                      ) : null}
                    </td>
                    <td className={c.lastStatus === "error" ? "form-error" : undefined} style={{ fontSize: 13 }}>
                      {c.lastStatus === "running" ? "идёт загрузка…" : c.lastMessage ?? "—"}
                    </td>
                    <td>
                      <div className="row-actions">
                        <form action={syncBankConnectionAction.bind(null, c.id)}>
                          <button type="submit" className="btn btn-secondary btn-sm">
                            Загрузить сейчас
                          </button>
                        </form>
                        <form action={toggleBankConnectionAction.bind(null, c.id)}>
                          <button type="submit" className="btn btn-ghost btn-sm">
                            {c.isActive ? "Выключить" : "Включить"}
                          </button>
                        </form>
                        <Link href={`/integrations/banks?replace=${c.id}#replace`} className="btn btn-ghost btn-sm">
                          Заменить реквизиты
                        </Link>
                        <form action={removeBankConnectionAction.bind(null, c.id)}>
                          <ConfirmSubmitButton className="btn btn-ghost btn-sm" message="Удалить подключение банка? Ключи доступа будут стёрты, загрузка выписок по API для этого счёта прекратится.">
                            Удалить
                          </ConfirmSubmitButton>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {connections.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Подключённых счетов нет — подключите счёт ниже.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {sp.replace && connections.some((c) => c.id === sp.replace) ? (
        <div className="card" id="replace" style={{ marginBottom: 16, maxWidth: 820 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Заменить реквизиты</h2>
          <form action={replaceBankCredentialsAction.bind(null, sp.replace)} className="form-grid" style={{ alignItems: "flex-end" }}>
            <CredentialFields provider={connections.find((c) => c.id === sp.replace)!.provider} />
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Проверить и сохранить
              </button>
              <Link href="/integrations/banks" className="btn btn-ghost">
                Отмена
              </Link>
            </div>
          </form>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16, maxWidth: 820 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Подключить счёт</h2>
        {accounts.length === 0 ? (
          <p className="text-muted">
            Все счета подключены или счетов нет — добавьте счёт в справочнике{" "}
            <Link href="/master-data/bank-accounts">«Банковские счета»</Link>.
          </p>
        ) : (
          <form action={addBankConnectionAction} className="form-grid" style={{ alignItems: "flex-end" }}>
            <label className="field">
              <span>Счёт *</span>
              <select name="bankAccountId" id="bank-api-account" required defaultValue="">
                <option value="">— выбрать —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bankName} {a.accountNumber} — {a.organization.shortName || a.organization.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Банк *</span>
              <select name="provider" id="bank-api-provider" required defaultValue="">
                <option value="">— выбрать —</option>
                {BANK_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {BANK_PROVIDER_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Загружать операции с *</span>
              <input type="date" name="syncFrom" id="bank-api-from" required defaultValue={defaultFrom} />
            </label>
            <CredentialFields provider={null} />
            <button type="submit" className="btn btn-primary">
              Проверить и подключить
            </button>
          </form>
        )}
        <p className="text-muted" style={{ marginTop: 10 }}>
          Перед сохранением система запрашивает у банка выписку за сегодня — неверные реквизиты не сохраняются. Если раньше
          выписку по счёту загружали файлами, операции из API с теми же днями, суммами и назначениями не задвоятся; при
          сомнениях ставьте дату начала после последней загруженной выписки.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 820 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Где взять реквизиты</h2>
        <ul style={{ paddingLeft: 18, display: "grid", gap: 8 }}>
          <li>
            <b>Т-Банк:</b> интернет-банк бизнеса → «Интеграции» / «Открытый API» → выпустить токен с доступом к выписке
            (чтение). Счёт — номер вашего счёта в справочнике.
          </li>
          <li>
            <b>Точка:</b> интернет-банк → «Интеграции и API» → создать JWT-токен с правами на чтение выписок. У счёта в
            справочнике должен быть заполнен БИК.
          </li>
          <li>
            <b>Сбер:</b> SberBusiness API подключается через кабинет разработчика банка (fintech.sberbank.ru): регистрация
            приложения, клиентский сертификат (.pfx) и согласие в СберБизнесе. Банк выдаёт client_id, client_secret и
            refresh_token; сертификат положите в папку на этом компьютере и укажите путь.
          </li>
          <li>
            <b>Альфа-Банк:</b> Alfa API (developers.alfabank.ru): регистрация приложения со сценарием «Выписка», сертификат и
            согласие в Альфа-Бизнесе; нужны client_id, client_secret и refresh_token.
          </li>
        </ul>
        <p className="text-muted" style={{ marginTop: 10 }}>
          Автоматическая загрузка по расписанию — задача Планировщика Windows: команда{" "}
          <code>powershell -ExecutionPolicy Bypass -File scripts\register-bank-sync-task.ps1</code> в папке программы
          (каждые 30 минут; <code>-Minutes 60</code> — раз в час, <code>-Remove</code> — удалить). Журнал —{" "}
          <code>backups\bank-sync.log</code>.
        </p>
      </div>
    </div>
  );
}

/** Поля реквизитов: токен для Т-Банка и Точки, OAuth и сертификат для Сбера и Альфы (для нового подключения — все, с подсказкой). */
function CredentialFields({ provider }: { provider: string | null }) {
  const tokenBank = provider === null || provider === "tbank" || provider === "tochka";
  const oauthBank = provider === null || provider === "sber" || provider === "alfa";
  return (
    <>
      {tokenBank ? (
        <label className="field">
          <span>Токен{provider === null ? " (Т-Банк, Точка)" : ""}</span>
          <input type="password" name="token" id={`bank-api-token-${provider ?? "new"}`} autoComplete="off" />
        </label>
      ) : null}
      {oauthBank ? (
        <>
          <label className="field">
            <span>client_id{provider === null ? " (Сбер, Альфа)" : ""}</span>
            <input type="text" name="clientId" id={`bank-api-client-${provider ?? "new"}`} autoComplete="off" />
          </label>
          <label className="field">
            <span>client_secret</span>
            <input type="password" name="clientSecret" id={`bank-api-secret-${provider ?? "new"}`} autoComplete="off" />
          </label>
          <label className="field">
            <span>refresh_token</span>
            <input type="password" name="refreshToken" id={`bank-api-refresh-${provider ?? "new"}`} autoComplete="off" />
          </label>
          <label className="field">
            <span>Путь к сертификату .pfx</span>
            <input type="text" name="certPath" id={`bank-api-cert-${provider ?? "new"}`} placeholder="C:\\keys\\bank.pfx" autoComplete="off" />
          </label>
          <label className="field">
            <span>Пароль сертификата</span>
            <input type="password" name="certPassword" id={`bank-api-cert-pass-${provider ?? "new"}`} autoComplete="off" />
          </label>
        </>
      ) : null}
    </>
  );
}
