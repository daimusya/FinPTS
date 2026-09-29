import { describe, expect, it } from "vitest";
import { importKeyFields, planImport, type ExistingRecord } from "./import-plan";
import type { ImportRow, SheetField } from "./spreadsheet";

const fields: SheetField[] = [
  { name: "fullName", label: "Полное наименование", type: "text", required: true },
  { name: "shortName", label: "Краткое наименование", type: "text" },
  { name: "inn", label: "ИНН", type: "text" },
  { name: "limit", label: "Лимит", type: "number" },
];

const existing: ExistingRecord[] = [
  { id: "c1", isArchived: false, values: { fullName: "ООО Ромашка", shortName: "Ромашка", inn: "7707083893", limit: "1000.00" } },
  { id: "c2", isArchived: false, values: { fullName: "ООО Лютик", shortName: null, inn: null, limit: null } },
  { id: "c3", isArchived: false, values: { fullName: "ООО Двойник", shortName: null, inn: "500100732259", limit: null } },
  { id: "c4", isArchived: false, values: { fullName: "ООО Двойник (филиал)", shortName: null, inn: "500100732259", limit: null } },
];

const row = (line: number, data: Record<string, unknown>, extra: Partial<ImportRow> = {}): ImportRow => ({
  line,
  id: null,
  data,
  cleared: [],
  present: ["fullName", "shortName", "inn", "limit"],
  archived: null,
  ...extra,
});

const plan = (rows: ImportRow[], mode: "upsert" | "create-only" = "upsert") =>
  planImport({ fields, rows, existing, mode, clearValue: () => null });

describe("importKeyFields", () => {
  it("tries INN, then the name", () => {
    expect(importKeyFields(fields)).toEqual(["inn", "fullName"]);
  });
});

describe("planImport", () => {
  it("re-importing an unchanged export changes nothing", () => {
    const p = plan([
      row(2, { fullName: "ООО Ромашка", shortName: "Ромашка", inn: "7707083893", limit: 1000 }, { id: "c1" }),
      row(3, { fullName: "ООО Лютик" }, { id: "c2", cleared: ["shortName", "inn", "limit"] }),
    ]);
    expect(p).toEqual({ creates: [], updates: [], archives: [], pendingCreates: [], unchanged: 2, skipped: 0, errors: [] });
  });

  it("updates only the changed columns, matching by INN or by name, and creates the rest", () => {
    const p = plan([
      row(2, { fullName: "ПАО Ромашка", shortName: "Ромашка", inn: "7707083893", limit: 1500 }),
      row(3, { fullName: "ооо лютик", inn: "7736207543" }, { present: ["fullName", "inn"] }),
      row(4, { fullName: "ООО Новая", inn: "7702070139" }),
    ]);
    expect(p.errors).toEqual([]);
    expect(p.updates).toEqual([
      { line: 2, id: "c1", data: { fullName: "ПАО Ромашка", limit: 1500 }, changed: ["Полное наименование", "Лимит"], label: "ООО Ромашка" },
      { line: 3, id: "c2", data: { fullName: "ооо лютик", inn: "7736207543" }, changed: ["Полное наименование", "ИНН"], label: "ООО Лютик" },
    ]);
    expect(p.creates).toEqual([{ line: 4, data: { fullName: "ООО Новая", inn: "7702070139" }, label: "ООО Новая" }]);
  });

  it("clears emptied optional columns and applies the archive status", () => {
    const p = plan([row(2, { fullName: "ООО Ромашка", inn: "7707083893" }, { cleared: ["shortName", "limit"], archived: true })]);
    expect(p.updates[0].data).toEqual({ shortName: null, limit: null, isArchived: true });
    expect(p.updates[0].changed).toEqual(["Краткое наименование", "Лимит", "Статус записи"]);
  });

  it("does not touch existing records in create-only mode", () => {
    const p = plan([row(2, { fullName: "ПАО Ромашка", inn: "7707083893" }), row(3, { fullName: "ООО Новая" })], "create-only");
    expect(p).toMatchObject({ updates: [], skipped: 1, creates: [{ line: 3 }] });
  });

  it("reports an unknown ID, an ambiguous key and duplicates inside the file", () => {
    const p = plan([
      row(2, { fullName: "X" }, { id: "missing" }),
      row(3, { fullName: "Двойник", inn: "500100732259" }),
      row(4, { fullName: "ООО Ромашка" }, { id: "c1" }),
      row(5, { fullName: "Ромашка снова", inn: "7707083893" }),
      row(6, { fullName: "ООО Новая" }),
      row(7, { fullName: "ооо новая" }),
    ]);
    expect(p.errors).toEqual([
      "Строка 2: записи с ID «missing» нет — очистите ячейку «ID записи», чтобы создать новую",
      "Строка 3: записей с полем «ИНН» = «500100732259» несколько — укажите нужную в колонке «ID записи» (она есть в выгрузке)",
      "Строки 4 и 5 относятся к одной записи «ООО Ромашка» — оставьте одну",
      "Строки 6 и 7 описывают одну и ту же новую запись «ооо новая» — оставьте одну",
    ]);
  });

  it("creates an archived record when the file says so", () => {
    expect(plan([row(2, { fullName: "ООО Старая" }, { archived: true })]).creates[0].data).toEqual({ fullName: "ООО Старая", isArchived: true });
  });
});

describe("planImport — matching by name when the INN finds nothing", () => {
  it("does not merge into a same-named record that has a different INN", () => {
    const withInn: ExistingRecord[] = [{ id: "d1", isArchived: false, values: { fullName: "ООО Альфа", inn: "7707083893" } }];
    const p = planImport({
      fields,
      rows: [row(2, { fullName: "ООО Альфа", inn: "7736207543" }, { present: ["fullName", "inn"] })],
      existing: withInn,
      mode: "upsert",
      clearValue: () => null,
    });
    expect(p.creates).toHaveLength(1);
    expect(p.updates).toHaveLength(0);
  });
});

describe("planImport — records missing from the file", () => {
  const sync = (rows: ImportRow[], mode: "upsert" | "create-only" = "upsert", records: ExistingRecord[] = existing) =>
    planImport({ fields, rows, existing: records, mode, clearValue: () => null, archiveMissing: true });

  it("archives the active records the file no longer lists, and only when asked", () => {
    const rows = [row(2, { fullName: "ООО Ромашка" }, { id: "c1", present: ["fullName"] }), row(3, { fullName: "ООО Лютик" }, { present: ["fullName"] })];
    expect(sync(rows).archives).toEqual([
      { id: "c3", label: "ООО Двойник" },
      { id: "c4", label: "ООО Двойник (филиал)" },
    ]);
    expect(plan(rows).archives).toEqual([]);
    expect(sync(rows, "create-only").archives).toEqual([]);
  });

  it("does not touch records already in the archive", () => {
    const withArchived: ExistingRecord[] = [...existing.slice(0, 1), { id: "old", isArchived: true, values: { fullName: "ООО Старая" } }];
    expect(sync([row(2, { fullName: "ООО Ромашка" }, { id: "c1", present: ["fullName"] })], "upsert", withArchived).archives).toEqual([]);
  });

  it("refuses to archive the whole dictionary when no row matches a record", () => {
    const p = sync([row(2, { fullName: "Совсем другая запись" }, { present: ["fullName"] })]);
    expect(p.archives).toEqual([]);
    expect(p.errors).toEqual([
      "Ни одна строка файла не совпала с существующими записями — отправить в архив все записи справочника (4) нельзя. Проверьте, что это выгрузка этого справочника",
    ]);
  });
});

describe("planImport — rows with cell errors", () => {
  it("still finds duplicates and ambiguous keys, but plans nothing for the broken row", () => {
    const p = plan([
      row(2, { fullName: "ООО Ромашка", inn: "7707083893" }, { invalid: true }),
      row(3, { fullName: "ООО Ромашка", inn: "7707083893", limit: 5 }),
      row(4, { fullName: "ООО Новая" }, { invalid: true }),
    ]);
    expect(p.errors).toEqual(["Строки 2 и 3 относятся к одной записи «ООО Ромашка» — оставьте одну"]);
    expect(p.updates).toEqual([]);
    expect(p.creates).toEqual([]);
    expect(p.pendingCreates.map((c) => c.line)).toEqual([4]);
  });
});
