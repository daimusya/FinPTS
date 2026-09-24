import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DictionaryConfig } from "./types";

export interface ColumnInfo {
  nullable: boolean;
  hasDbDefault: boolean;
}

/**
 * Сведения о колонках модели справочника из описания схемы Prisma. Модель
 * находится по делегату (prisma.project и т.п.) — конфигурация справочника
 * хранит именно его.
 */
export function dictionaryColumns(config: DictionaryConfig): Map<string, ColumnInfo> {
  const client = prisma as unknown as Record<string, unknown>;
  const model = Prisma.dmmf.datamodel.models.find((m) => client[m.name[0].toLowerCase() + m.name.slice(1)] === config.delegate);
  if (!model) throw new Error(`Модель справочника «${config.slug}» не найдена в схеме`);
  return new Map(model.fields.map((f) => [f.name, { nullable: !f.isRequired, hasDbDefault: f.hasDefaultValue }]));
}

/**
 * Что записать, если необязательное поле формы оставили пустым:
 * — значение по умолчанию поля, если оно задано;
 * — при создании — ничего (сработает значение по умолчанию из БД);
 * — при изменении — null, если колонка его допускает (иначе очистить поле
 *   было бы нельзя: «ничего» в update значит «не менять»), а для колонки
 *   NOT NULL — ничего, то есть прежнее значение остаётся.
 */
export function emptyFieldValue(
  field: { defaultValue?: string },
  mode: "create" | "update",
  column: ColumnInfo | undefined,
): string | null | undefined {
  if (field.defaultValue !== undefined) return field.defaultValue;
  if (mode === "create") return undefined;
  return column?.nullable ? null : undefined;
}
