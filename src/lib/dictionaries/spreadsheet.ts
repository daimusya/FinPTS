import type { FieldOption, FieldType } from "./types";

export interface SheetField {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  defaultValue?: string;
}

export const ARCHIVE_COLUMN_LABEL = "Статус записи";

type Cell = string | number | null;

function formatExportCell(field: SheetField, value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (field.type === "checkbox") return value ? "да" : "нет";
  if (field.type === "date") {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }
  if (field.type === "select") {
    const option = field.options?.find((o) => o.value === String(value));
    return option ? option.label : String(value);
  }
  if (field.type === "number") {
    const num = Number(String(value));
    return Number.isNaN(num) ? String(value) : num;
  }
  return String(value);
}

/**
 * Лист экспорта справочника: заголовки — подписи полей формы, значения
 * списков — человекочитаемые названия (а не внутренние ID), чтобы тот же
 * файл можно было отредактировать и загрузить обратно через импорт.
 */
export function buildExportRows(fields: SheetField[], items: Array<Record<string, unknown>>): Array<Array<string | number>> {
  const header = [...fields.map((f) => f.label), ARCHIVE_COLUMN_LABEL];
  const rows = items.map((item) => [
    ...fields.map((f) => formatExportCell(f, item[f.name])),
    item.isArchived ? "В архиве" : "Активна",
  ]);
  return [header, ...rows];
}

function normalizeHeader(value: string): string {
  return value.replace(/\*/g, "").trim().toLowerCase();
}

function parseDate(value: string): Date | null {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const ru = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  const parts = iso ? [iso[1], iso[2], iso[3]] : ru ? [ru[3], ru[2], ru[1]] : null;
  if (!parts) return null;
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC silently rolls 32.13.2026 over into 2027 — reject anything that didn't round-trip.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

const TRUE_VALUES = new Set(["да", "true", "1", "yes"]);
const FALSE_VALUES = new Set(["нет", "false", "0", "no"]);

export interface ImportParseResult {
  records: Array<Record<string, unknown>>;
  errors: string[];
}

/**
 * Разбирает строки файла импорта в данные для создания записей. Колонки
 * сопоставляются с полями по подписи (регистр и звёздочка «обязательно»
 * не важны), лишние колонки игнорируются. Ошибки собираются по всем
 * строкам сразу — вызывающий код загружает файл только если ошибок нет.
 * Пустое необязательное поле не передаётся вовсе (undefined), чтобы
 * сработало значение по умолчанию из БД.
 */
export function parseImportRows(fields: SheetField[], headers: string[], rows: Cell[][]): ImportParseResult {
  const errors: string[] = [];
  const columnIndex = new Map<string, number>();
  headers.forEach((h, idx) => columnIndex.set(normalizeHeader(String(h ?? "")), idx));

  const fieldColumns = fields.map((field) => ({ field, index: columnIndex.get(normalizeHeader(field.label)) }));
  for (const { field, index } of fieldColumns) {
    if (field.required && index === undefined) errors.push(`В файле нет колонки «${field.label}»`);
  }
  if (errors.length > 0) return { records: [], errors };

  const records: Array<Record<string, unknown>> = [];
  rows.forEach((row, rowIdx) => {
    const lineNo = rowIdx + 2;
    const isEmpty = fieldColumns.every(({ index }) => index === undefined || String(row[index] ?? "").trim() === "");
    if (isEmpty) return;

    const data: Record<string, unknown> = {};
    for (const { field, index } of fieldColumns) {
      const raw = index === undefined ? "" : String(row[index] ?? "").trim();

      if (field.type === "checkbox") {
        const lower = raw.toLowerCase();
        if (raw === "" || FALSE_VALUES.has(lower)) data[field.name] = false;
        else if (TRUE_VALUES.has(lower)) data[field.name] = true;
        else errors.push(`Строка ${lineNo}: «${raw}» в поле «${field.label}» — ожидается «да» или «нет»`);
        continue;
      }

      if (raw === "") {
        if (field.required) errors.push(`Строка ${lineNo}: поле «${field.label}» обязательно`);
        else data[field.name] = field.defaultValue;
        continue;
      }

      if (field.type === "select") {
        const options = field.options ?? [];
        const byValue = options.find((o) => o.value === raw);
        const byLabel = options.filter((o) => o.label.toLowerCase() === raw.toLowerCase());
        // Two records with the same name (e.g. organizations) — picking either would silently link the wrong one.
        if (byValue) data[field.name] = byValue.value;
        else if (byLabel.length === 1) data[field.name] = byLabel[0].value;
        else if (byLabel.length > 1)
          errors.push(`Строка ${lineNo}: «${raw}» в поле «${field.label}» — несколько записей с таким названием, переименуйте одну из них`);
        else errors.push(`Строка ${lineNo}: «${raw}» — нет такого значения для поля «${field.label}»`);
      } else if (field.type === "number") {
        const num = Number(raw.replace(/\s/g, "").replace(",", "."));
        if (Number.isNaN(num)) errors.push(`Строка ${lineNo}: «${raw}» в поле «${field.label}» — не число`);
        else data[field.name] = num;
      } else if (field.type === "date") {
        const date = parseDate(raw);
        if (date) data[field.name] = date;
        else errors.push(`Строка ${lineNo}: «${raw}» в поле «${field.label}» — дата должна быть в виде ГГГГ-ММ-ДД или ДД.ММ.ГГГГ`);
      } else {
        data[field.name] = raw;
      }
    }
    records.push(data);
  });

  if (records.length === 0 && errors.length === 0) errors.push("В файле нет строк с данными");
  return { records: errors.length > 0 ? [] : records, errors };
}
