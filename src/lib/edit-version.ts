import { createHash } from "node:crypto";

/**
 * Защита от затирания чужих изменений: форма редактирования запоминает
 * отпечаток значений записи на момент открытия (скрытое поле «_version»),
 * действие сравнивает его с тем, что сейчас в базе. Если запись успели
 * изменить (другой пользователь, другая вкладка), сохранение останавливается,
 * а не перезаписывает чужую правку. Отпечаток берётся только по полям, которые
 * форма меняет, — посторонние изменения записи конфликтом не считаются.
 */
export const VERSION_FIELD = "_version";

export const STALE_EDIT =
  "Запись изменили, пока вы её редактировали (другой пользователь или другая вкладка). Откройте её заново и внесите правку ещё раз — иначе чужие изменения были бы затёрты.";

function normalize(value: unknown): unknown {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object" && "toFixed" in (value as object)) return String(value);
  if (typeof value === "number") return String(value);
  return value;
}

export function editVersion(record: Record<string, unknown>, fields: string[]): string {
  const values = fields.map((field) => [field, normalize(record[field])]);
  return createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 20);
}

/** Совпадает ли версия из формы с текущей. Форма без версии (старые вкладки, скрипты) не проверяется. */
export function versionMatches(submitted: FormDataEntryValue | null, current: string): boolean {
  return typeof submitted !== "string" || submitted === "" || submitted === current;
}
