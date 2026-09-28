import { ARCHIVE_COLUMN_LABEL, type ImportRow, type SheetField } from "./spreadsheet";

export type ImportMode = "upsert" | "create-only";

export interface ExistingRecord {
  id: string;
  isArchived: boolean;
  values: Record<string, unknown>;
}

export interface PlannedCreate {
  line: number;
  data: Record<string, unknown>;
  label: string;
}

export interface PlannedUpdate {
  line: number;
  id: string;
  data: Record<string, unknown>;
  /** Подписи изменившихся полей — для просмотра перед загрузкой. */
  changed: string[];
  label: string;
}

export interface ImportPlan {
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  unchanged: number;
  /** Строки про существующие записи в режиме «только добавлять». */
  skipped: number;
  errors: string[];
}

/** Поля, по которым строка без ID ищет существующую запись: ИНН, код, номер счёта, затем название. */
export function importKeyFields(fields: SheetField[]): string[] {
  const keys = ["inn", "code", "accountNumber"].filter((name) => fields.some((f) => f.name === name));
  const nameField = fields.find((f) => f.required && f.type === "text");
  return nameField ? [...keys, nameField.name] : keys;
}

/** Значение поля в сравнимом виде: пусто = "", даты — ГГГГ-ММ-ДД, числа — без хвостовых нулей. */
function comparable(field: SheetField | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (field?.type === "number") {
    const n = Number(String(value));
    return Number.isNaN(n) ? String(value) : String(n);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

const keyValue = (value: unknown) => comparable(undefined, value).toLowerCase();

/**
 * План загрузки справочника: для каждой строки — создать, обновить (только
 * изменившиеся поля из присутствующих в файле колонок) или ничего не делать.
 * Запись ищется по ID из колонки «ID записи», иначе по ключевым полям по
 * порядку (ИНН → код → номер счёта → название): одна найденная запись —
 * обновление, несколько — ошибка, ни одной — следующий ключ, но только среди
 * записей, у которых предыдущие ключи пусты (запись без ИНН может оказаться
 * той же по названию, запись с другим ИНН — нет); не нашлось — создание.
 * Две строки файла про одну запись (или одна и та же новая запись дважды) —
 * ошибка: неясно, какая из строк верна.
 */
export function planImport(input: {
  fields: SheetField[];
  rows: ImportRow[];
  existing: ExistingRecord[];
  mode: ImportMode;
  /** Что записать в очищенное поле при обновлении (null или значение по умолчанию); undefined — поле не очищается. */
  clearValue: (fieldName: string) => unknown;
}): ImportPlan {
  const { fields, rows, existing, mode } = input;
  const fieldByName = new Map(fields.map((f) => [f.name, f]));
  const keys = importKeyFields(fields);
  const nameField = keys.at(-1);
  const byId = new Map(existing.map((r) => [r.id, r]));
  const plan: ImportPlan = { creates: [], updates: [], unchanged: 0, skipped: 0, errors: [] };
  const seenRecords = new Map<string, number>();
  const seenNew = new Map<string, number>();
  const labelOf = (values: Record<string, unknown>) => (nameField ? String(values[nameField] ?? "") : "");

  for (const row of rows) {
    let target: ExistingRecord | null = null;
    let newKey: string | null = null;

    if (row.id) {
      target = byId.get(row.id) ?? null;
      if (!target) {
        plan.errors.push(`Строка ${row.line}: записи с ID «${row.id}» нет — очистите ячейку «ID записи», чтобы создать новую`);
        continue;
      }
    } else {
      // Keys filled in the row, in priority order. A later key only matches records that have no value in the
      // earlier ones: a record without an INN may be the same company by name, one with another INN is not.
      const filled = keys.filter((k) => keyValue(row.data[k]) !== "");
      let ambiguous = false;
      for (const [i, key] of filled.entries()) {
        const value = keyValue(row.data[key]);
        const earlier = filled.slice(0, i);
        const matches = existing.filter((r) => keyValue(r.values[key]) === value && earlier.every((k) => keyValue(r.values[k]) === ""));
        if (matches.length > 1) {
          const label = fieldByName.get(key)?.label ?? key;
          plan.errors.push(
            `Строка ${row.line}: записей с полем «${label}» = «${String(row.data[key])}» несколько — укажите нужную в колонке «ID записи» (она есть в выгрузке)`,
          );
          ambiguous = true;
          break;
        }
        if (matches.length === 1) {
          target = matches[0];
          break;
        }
      }
      if (ambiguous) continue;
      if (!target && filled.length > 0) newKey = `${filled[0]}:${keyValue(row.data[filled[0]])}`;
    }

    if (target) {
      const first = seenRecords.get(target.id);
      if (first !== undefined) {
        plan.errors.push(`Строки ${first} и ${row.line} относятся к одной записи «${labelOf(target.values)}» — оставьте одну`);
        continue;
      }
      seenRecords.set(target.id, row.line);
      if (mode === "create-only") {
        plan.skipped++;
        continue;
      }

      const data: Record<string, unknown> = {};
      const changed: string[] = [];
      for (const name of row.present) {
        const field = fieldByName.get(name);
        const next = row.cleared.includes(name) ? input.clearValue(name) : row.data[name];
        if (next === undefined) continue; // a NOT NULL column without a default — an empty cell keeps the old value
        if (comparable(field, next) !== comparable(field, target.values[name])) {
          data[name] = next;
          changed.push(field?.label ?? name);
        }
      }
      if (row.archived !== null && row.archived !== target.isArchived) {
        data.isArchived = row.archived;
        changed.push(ARCHIVE_COLUMN_LABEL);
      }
      if (changed.length === 0) plan.unchanged++;
      else plan.updates.push({ line: row.line, id: target.id, data, changed, label: labelOf(target.values) });
      continue;
    }

    if (newKey) {
      const first = seenNew.get(newKey);
      if (first !== undefined) {
        plan.errors.push(`Строки ${first} и ${row.line} описывают одну и ту же новую запись «${labelOf(row.data)}» — оставьте одну`);
        continue;
      }
      seenNew.set(newKey, row.line);
    }
    plan.creates.push({ line: row.line, data: row.archived ? { ...row.data, isArchived: true } : row.data, label: labelOf(row.data) });
  }
  return plan;
}
