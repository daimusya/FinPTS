import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { decryptSecret, maskSecret } from "@/lib/crypto/secret-box";
import { INN_PROFILE_SYSTEM, lookupRequisitesByInn } from "@/lib/integrations/inn-service";
import { saveInnLookupSettingsAction } from "./actions";

const FIELD_LABELS: Array<[keyof import("@/lib/integrations/inn").PartyRequisites, string]> = [
  ["fullName", "Полное наименование"],
  ["shortName", "Краткое наименование"],
  ["inn", "ИНН"],
  ["kpp", "КПП"],
  ["ogrn", "ОГРН / ОГРНИП"],
  ["legalAddress", "Юридический адрес"],
  ["director", "Руководитель"],
  ["status", "Статус"],
  ["registrationDate", "Дата регистрации"],
  ["liquidationDate", "Дата прекращения деятельности"],
];

const showValue = (value: string | Date | null) =>
  value instanceof Date ? value.toLocaleDateString("ru-RU", { timeZone: "UTC" }) : (value ?? "—");

export default async function InnLookupSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; testInn?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.INTEGRATIONS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления интеграциями.</div>
      </div>
    );
  }
  const sp = await searchParams;
  const profile = await prisma.integrationProfile.findFirst({ where: { system: INN_PROFILE_SYSTEM } });
  const config = (profile?.config ?? {}) as { apiKeyEnc?: string; autoCreate?: boolean };
  const apiKeyEnc = config.apiKeyEnc;
  const keyMasked = apiKeyEnc ? maskSecret(decryptSecret(apiKeyEnc)) : null;
  const test = sp.testInn ? await lookupRequisitesByInn(sp.testInn) : null;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Реквизиты по ИНН</h1>
          <p>
            Заполнение реквизитов контрагента по ИНН из ЕГРЮЛ/ЕГРИП через сервис DaData: наименование, КПП, ОГРН,
            юридический адрес, руководитель и статус (действует, ликвидируется и т.д.). Нужен ключ API — его выдают
            бесплатно после регистрации на dadata.ru (раздел «Ключи API» в личном кабинете). Сам ИНН проверяется по
            контрольным цифрам ещё до запроса.
          </p>
        </div>
      </div>

      {sp.saved ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-success">Настройки сохранены.</p>
        </div>
      ) : null}
      {sp.error ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="form-error">{sp.error}</p>
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Ключ DaData</h2>
        <form action={saveInnLookupSettingsAction}>
          {keyMasked ? (
            <p className="text-muted" style={{ marginBottom: 8 }}>
              Текущий ключ: <span className="mono">{keyMasked}</span> (хранится в зашифрованном виде)
            </p>
          ) : null}
          <label className="field">
            <span>{keyMasked ? "Новый ключ API (оставьте пустым, чтобы не менять)" : "Ключ API"}</span>
            <input type="password" name="apiKey" autoComplete="off" placeholder="API-ключ из личного кабинета DaData" />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13 }}>
            <input type="checkbox" name="isEnabled" defaultChecked={profile?.isEnabled ?? false} />
            Поиск по ИНН включён (без ключа включить нельзя)
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, fontSize: 13 }}>
            <input type="checkbox" name="autoCreate" id="inn-auto-create" defaultChecked={config.autoCreate ?? false} style={{ marginTop: 3 }} />
            <span>
              Создавать контрагентов по ИНН автоматически
              <span className="text-muted" style={{ display: "block", fontSize: 12 }}>
                При загрузке выписки (из файла и по API банков) и документов 1С контрагент с новым ИНН создаётся с реквизитами
                из ЕГРЮЛ/ЕГРИП и сразу привязывается. ИНН, которых нет в реестре (например, физлиц), пропускаются. Выключено —
                контрагентов можно создать кнопкой в списке операций банка.
              </span>
            </span>
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Сохранить
            </button>
          </div>
        </form>
      </div>

      <div className="card" style={{ maxWidth: 720 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Проверить поиск</h2>
        <form className="filter-bar">
          <label className="field">
            <span>ИНН</span>
            <input type="text" name="testInn" inputMode="numeric" defaultValue={sp.testInn ?? ""} required style={{ width: 160 }} />
          </label>
          <button type="submit" className="btn btn-secondary">
            Найти (ничего не сохраняется)
          </button>
        </form>
        {test ? (
          test.found ? (
            <table style={{ marginTop: 12 }}>
              <tbody>
                {FIELD_LABELS.map(([key, label]) => (
                  <tr key={key}>
                    <td className="text-muted">{label}</td>
                    <td>{showValue(test.requisites[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="form-error" style={{ marginTop: 12 }}>
              {test.error}
            </p>
          )
        ) : null}
        <p className="text-muted" style={{ marginTop: 12 }}>
          В работе поиск используется в справочнике <Link href="/master-data/counterparties">«Контрагенты»</Link>: «Добавить по
          ИНН» в списке и «Обновить по ИНН» в карточке контрагента.
        </p>
      </div>
    </div>
  );
}
