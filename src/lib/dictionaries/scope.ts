import type { AccessScope } from "@/lib/access-scope";
import type { DictionaryConfig } from "./types";

/**
 * Ограничение видимости для справочников (как у документов и заявок,
 * src/lib/access-scope.ts). К организации привязаны справочники с полем
 * «Организация» (счета, кассы, проекты, договоры, ОС, займы…) и сам
 * справочник организаций; подразделение без организации — общее и видно всем.
 * Подразделения и проекты, кроме того, ограничиваются назначенными
 * пользователю подразделениями и проектами. Остальные справочники
 * (контрагенты, статьи, должности…) общие.
 */
export interface OrganizationBinding {
  field: string;
  /** Запись без организации общая — видна при любом ограничении. */
  nullable: boolean;
}

export const ORGANIZATION_RECORD_NOT_ALLOWED = "У вас нет доступа к этой организации — выберите организацию из своих";

export function organizationBinding(config: Pick<DictionaryConfig, "slug" | "fields">): OrganizationBinding | null {
  if (config.slug === "organizations") return { field: "id", nullable: false };
  const field = config.fields.find((f) => f.name === "organizationId");
  return field ? { field: field.name, nullable: !field.required } : null;
}

/** Справочники, записи которых ограничиваются и списком назначенных пользователю id. */
const OWN_ID_RESTRICTION: Record<string, { key: "departmentIds" | "projectIds"; newRecord: string }> = {
  departments: {
    key: "departmentIds",
    newRecord: "У вас ограничен доступ по подразделениям — новое подразделение заводит пользователь без такого ограничения",
  },
  projects: { key: "projectIds", newRecord: "У вас ограничен доступ по проектам — новый проект заводит пользователь без такого ограничения" },
};

const ownIds = (config: Pick<DictionaryConfig, "slug">, scope: AccessScope): string[] | null => {
  const restriction = OWN_ID_RESTRICTION[config.slug];
  return restriction ? scope[restriction.key] : null;
};

/** where-условие для списка, выгрузки и сопоставления при загрузке; {} — без ограничения. */
export function dictionaryScopeWhere(config: Pick<DictionaryConfig, "slug" | "fields">, scope: AccessScope): Record<string, unknown> {
  const parts: Record<string, unknown>[] = [];
  const binding = organizationBinding(config);
  if (binding && scope.organizationIds) {
    const inScope = { [binding.field]: { in: scope.organizationIds } };
    parts.push(binding.nullable ? { OR: [inScope, { [binding.field]: null }] } : inScope);
  }
  const ids = ownIds(config, scope);
  if (ids) parts.push({ id: { in: ids } });
  return parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { AND: parts };
}

/** Видна ли запись (или допустима ли изменённая) пользователю с этим ограничением. */
export function dictionaryRecordAllowed(
  config: Pick<DictionaryConfig, "slug" | "fields">,
  scope: AccessScope,
  record: Record<string, unknown> | null | undefined,
): boolean {
  if (!record) return true;
  const ids = ownIds(config, scope);
  if (ids && !ids.includes(String(record.id ?? ""))) return false;
  const binding = organizationBinding(config);
  if (!binding || !scope.organizationIds) return true;
  const value = record[binding.field];
  if (value === null || value === undefined || value === "") return binding.nullable;
  return scope.organizationIds.includes(String(value));
}

export const NEW_ORGANIZATION_NOT_ALLOWED =
  "У вас ограничен доступ по организациям — новую организацию заводит пользователь без такого ограничения";

/**
 * Проверка новой записи; null — можно сохранять. Новую организацию,
 * подразделение или проект заводит только пользователь без соответствующего
 * ограничения (иначе запись сразу пропала бы у него из вида).
 */
export function dictionaryCreateProblem(
  config: Pick<DictionaryConfig, "slug" | "fields">,
  scope: AccessScope,
  data: Record<string, unknown>,
): string | null {
  if (ownIds(config, scope)) return OWN_ID_RESTRICTION[config.slug].newRecord;
  if (!scope.organizationIds) return null;
  if (organizationBinding(config)?.field === "id") return NEW_ORGANIZATION_NOT_ALLOWED;
  return dictionaryRecordAllowed(config, scope, data) ? null : ORGANIZATION_RECORD_NOT_ALLOWED;
}
