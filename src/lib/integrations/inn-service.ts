import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { lookupPartyByInn, validateInn, type InnLookupResult, type PartyRequisites } from "./inn";

export const INN_PROFILE_SYSTEM = "DADATA";

interface InnProfileConfig {
  apiKeyEnc?: string;
  /** Создавать контрагентов по ИНН автоматически при загрузке выписок и 1С. */
  autoCreate?: boolean;
}

async function loadProfile() {
  const profile = await prisma.integrationProfile.findFirst({ where: { system: INN_PROFILE_SYSTEM } });
  return { profile, config: (profile?.config ?? {}) as InnProfileConfig };
}

/** Ключ DaData из профиля интеграции (хранится зашифрованным); null — сервис не настроен или выключен. */
export async function getDadataApiKey(): Promise<string | null> {
  const { profile, config } = await loadProfile();
  if (!profile?.isEnabled || !config.apiKeyEnc) return null;
  return decryptSecret(config.apiKeyEnc);
}

/** Включено ли автоматическое создание контрагентов по ИНН (и сервис настроен). */
export async function isAutoCreateEnabled(): Promise<boolean> {
  const { profile, config } = await loadProfile();
  return Boolean(profile?.isEnabled && config.apiKeyEnc && config.autoCreate);
}

export async function lookupRequisitesByInn(inn: string): Promise<InnLookupResult> {
  // A typo is reported even without the service configured.
  const invalid = validateInn(inn);
  if (invalid) return { found: false, error: invalid };
  const apiKey = await getDadataApiKey();
  if (!apiKey) {
    return {
      found: false,
      error: "Поиск по ИНН не настроен — укажите ключ DaData в разделе «Интеграции → Реквизиты по ИНН»",
    };
  }
  return lookupPartyByInn(inn, apiKey);
}

/** Поля контрагента из реестра: наименование, КПП, ОГРН, юр. адрес, руководитель, статус. */
export function counterpartyDataFromRegistry(r: PartyRequisites) {
  return {
    fullName: r.fullName,
    shortName: r.shortName,
    kpp: r.kpp,
    ogrn: r.ogrn,
    legalAddress: r.legalAddress,
    director: r.director,
    status: r.status,
    dataSource: "DADATA",
    dataUpdatedAt: new Date(),
  };
}

/**
 * Поля организации из реестра. Тип (ООО / ИП) и даты регистрации и
 * прекращения деятельности тоже из реестра — от них зависят взносы ИП и
 * налоги в сценариях; дата прекращения — только если деятельность прекращена.
 */
export function organizationDataFromRegistry(r: PartyRequisites) {
  return {
    name: r.fullName,
    shortName: r.shortName,
    type: r.type,
    kpp: r.kpp,
    ogrn: r.ogrn,
    legalAddress: r.legalAddress,
    registrationDate: r.registrationDate,
    closureDate: r.liquidationDate,
    dataSource: "DADATA",
    dataUpdatedAt: new Date(),
  };
}

/** Какие поля изменятся (подписи для сообщения); служебные поля источника не считаются. */
export function changedRegistryFields(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): string[] {
  const same = (a: unknown, b: unknown) => {
    const norm = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : (v ?? null));
    return norm(a) === norm(b);
  };
  return Object.keys(labels).filter((key) => key in after && !same(before[key], after[key])).map((key) => labels[key]);
}

/**
 * Контрагент без реквизитов реестра: заведён загрузкой из 1С или вручную
 * одним наименованием с ИНН (нет ни КПП, ни ОГРН, ни адреса). Такие можно
 * дополнить из реестра разом, не рискуя затереть введённое руками.
 */
export function needsRegistryData(c: { inn: string | null; dataSource: string | null; kpp: string | null; ogrn: string | null; legalAddress: string | null }): boolean {
  if (!c.inn || c.dataSource === "DADATA") return false;
  return c.dataSource === "1C" || (!c.kpp && !c.ogrn && !c.legalAddress);
}

export type EnsureOutcome = { id: string; created: boolean } | { id: null; error: string };

/**
 * Контрагент с этим ИНН: существующий или новый из реестра. Если в реестре
 * не нашлось (например, ИНН физлица) или сервис не ответил — null с причиной.
 */
export async function ensureCounterpartyByInn(inn: string): Promise<EnsureOutcome> {
  const clean = inn.replace(/\s/g, "");
  const existing = await prisma.counterparty.findFirst({ where: { inn: clean } });
  if (existing) return { id: existing.id, created: false };
  const result = await lookupRequisitesByInn(clean);
  if (!result.found) return { id: null, error: result.error };
  const created = await prisma.counterparty.create({ data: { inn: result.requisites.inn, ...counterpartyDataFromRegistry(result.requisites) } });
  return { id: created.id, created: true };
}
