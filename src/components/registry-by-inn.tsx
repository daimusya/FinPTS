import Link from "next/link";
import { prisma } from "@/lib/db";
import { getDadataApiKey, needsRegistryData } from "@/lib/integrations/inn-service";
import {
  createCounterpartiesFromOperationsAction,
  createOrganizationByInnAction,
  enrichCounterpartiesAction,
  refreshOrganizationByInnAction,
} from "@/app/(app)/integrations/inn/registry-actions";

const notConfigured = (
  <span className="text-muted">
    Поиск по ИНН не настроен — ключ DaData задаётся в разделе <Link href="/integrations/inn">«Интеграции → Реквизиты по ИНН»</Link>.
  </span>
);

/** Список операций: операции с ИНН, но без контрагента, — создать контрагентов из реестра и привязать. */
export async function OperationsWithoutCounterparty({ returnTo }: { returnTo: string }) {
  const groups = await prisma.bankTransaction.groupBy({
    by: ["counterpartyInn"],
    where: { counterpartyId: null, isTransfer: false, counterpartyInn: { not: null } },
    _count: true,
  });
  if (groups.length === 0) return null;
  const operations = groups.reduce((sum, g) => sum + g._count, 0);
  const ready = Boolean(await getDadataApiKey());
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <p style={{ marginBottom: 8 }}>
        Операций с ИНН, но без контрагента: <strong>{operations}</strong> (разных ИНН: {groups.length}).
      </p>
      {ready ? (
        <form action={createCounterpartiesFromOperationsAction} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input type="hidden" name="returnTo" value={returnTo} />
          <button type="submit" className="btn btn-secondary">
            Создать контрагентов по ИНН
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Реквизиты — из ЕГРЮЛ/ЕГРИП, операции с этим ИНН привязываются. Закрытые периоды не меняются, ИНН физлиц
            пропускаются. До 50 ИНН за раз.
          </span>
        </form>
      ) : (
        notConfigured
      )}
    </div>
  );
}

/** Список контрагентов: дополнить реквизиты у заведённых загрузкой (1С) или одним наименованием с ИНН. */
export async function CounterpartyEnrich() {
  const candidates = (
    await prisma.counterparty.findMany({
      where: { isArchived: false, inn: { not: null }, OR: [{ dataSource: null }, { dataSource: { not: "DADATA" } }] },
      select: { inn: true, dataSource: true, kpp: true, ogrn: true, legalAddress: true },
    })
  ).filter(needsRegistryData);
  if (candidates.length === 0) return null;
  const ready = Boolean(await getDadataApiKey());
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <p style={{ marginBottom: 8 }}>
        Контрагентов с ИНН, но без реквизитов из реестра: <strong>{candidates.length}</strong> — заведены загрузкой из 1С или вручную
        одним наименованием.
      </p>
      {ready ? (
        <form action={enrichCounterpartiesAction} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-secondary">
            Дополнить реквизиты по ИНН
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Наименование, КПП, ОГРН, юр. адрес, руководитель и статус — из ЕГРЮЛ/ЕГРИП. Контрагенты, у которых КПП, ОГРН или адрес
            уже введены вручную, не трогаются. До 50 за раз.
          </span>
        </form>
      ) : (
        notConfigured
      )}
    </div>
  );
}

/** Список организаций: добавить по ИНН. */
export function OrganizationCreateByInn({ error }: { error?: string }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <form action={createOrganizationByInnAction} className="filter-bar" style={{ marginBottom: 0 }}>
        <label className="field">
          <span>Добавить организацию или ИП по ИНН</span>
          <input type="text" name="inn" id="org-inn" inputMode="numeric" required placeholder="10 или 12 цифр" style={{ width: 180 }} />
        </label>
        <button type="submit" className="btn btn-secondary">
          Заполнить из ЕГРЮЛ/ЕГРИП
        </button>
      </form>
      {error ? (
        <p className="form-error" style={{ marginTop: 10 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Карточка организации: откуда реквизиты и обновление по ИНН. */
export async function OrganizationInnCard({ organizationId }: { organizationId: string }) {
  const [organization, ready] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }),
    getDadataApiKey().then(Boolean),
  ]);
  return (
    <div className="card" style={{ maxWidth: 720, marginTop: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Реквизиты по ИНН</h2>
      <p className="text-muted" style={{ marginBottom: 10 }}>
        {organization.dataSource === "DADATA"
          ? `Реквизиты из ЕГРЮЛ/ЕГРИП${organization.dataUpdatedAt ? `, обновлены ${organization.dataUpdatedAt.toLocaleString("ru-RU")}` : ""}.`
          : "Реквизиты введены вручную."}
      </p>
      {!organization.inn ? (
        <p className="text-muted">Укажите ИНН в форме выше, чтобы заполнять реквизиты из ЕГРЮЛ/ЕГРИП.</p>
      ) : ready ? (
        <form action={refreshOrganizationByInnAction.bind(null, organizationId)} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="btn btn-secondary">
            Обновить по ИНН {organization.inn}
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Наименование, КПП, ОГРН, юр. адрес, тип (организация или ИП), даты регистрации и прекращения деятельности будут заменены
            данными реестра. Система налогообложения и ставки не меняются.
          </span>
        </form>
      ) : (
        notConfigured
      )}
    </div>
  );
}
