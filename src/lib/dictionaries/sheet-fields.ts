import type { DictionaryConfig } from "./types";
import type { SheetField } from "./spreadsheet";

/** Подгружает варианты для полей-списков (в т.ч. связей вроде организации), чтобы экспорт/импорт работали с названиями, а не с ID. */
export async function resolveSheetFields(config: DictionaryConfig): Promise<SheetField[]> {
  return Promise.all(
    config.fields.map(async (field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      defaultValue: field.defaultValue,
      options: field.options ?? (field.loadOptions ? await field.loadOptions() : undefined),
    })),
  );
}
