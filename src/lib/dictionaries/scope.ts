import type { AccessScope } from "@/lib/access-scope";
import type { DictionaryConfig } from "./types";

/**
 * Ограничение видимости по организациям для справочников (как у документов и
 * заявок, src/lib/access-scope.ts). К организации привязаны справочники с
 * полем «Организация» (счета, кассы, проекты, договоры, ОС, займы…) и сам
 * справочник организаций; подразделение без организации — общее и видно всем.
 * Остальные справочники (контрагенты, статьи, должности…) общие.
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

/** where-условие для списка, выгрузки и сопоставления при загрузке; {} — без ограничения. */
export function dictionaryScopeWhere(config: Pick<DictionaryConfig, "slug" | "fields">, scope: AccessScope): Record<string, unknown> {
  const binding = organizationBinding(config);
  if (!binding || !scope.organizationIds) return {};
  const inScope = { [binding.field]: { in: scope.organizationIds } };
  return binding.nullable ? { OR: [inScope, { [binding.field]: null }] } : inScope;
}

/** Видна ли запись (или допустима ли новая/изменённая) пользователю с этим ограничением. */
export function dictionaryRecordAllowed(
  config: Pick<DictionaryConfig, "slug" | "fields">,
  scope: AccessScope,
  record: Record<string, unknown> | null | undefined,
): boolean {
  const binding = organizationBinding(config);
  if (!binding || !scope.organizationIds || !record) return true;
  const value = record[binding.field];
  if (value === null || value === undefined || value === "") return binding.nullable;
  return scope.organizationIds.includes(String(value));
}

export const NEW_ORGANIZATION_NOT_ALLOWED =
  "У вас ограничен доступ по организациям — новую организацию заводит пользователь без такого ограничения";

/** Проверка новой записи; null — можно сохранять. Новая организация — только без ограничения по организациям. */
export function dictionaryCreateProblem(
  config: Pick<DictionaryConfig, "slug" | "fields">,
  scope: AccessScope,
  data: Record<string, unknown>,
): string | null {
  if (!scope.organizationIds) return null;
  if (organizationBinding(config)?.field === "id") return NEW_ORGANIZATION_NOT_ALLOWED;
  return dictionaryRecordAllowed(config, scope, data) ? null : ORGANIZATION_RECORD_NOT_ALLOWED;
}
