import { describe, expect, it } from "vitest";
import { ARCHIVE_COLUMN_LABEL, buildExportRows, parseImportRows, type SheetField } from "./spreadsheet";

const fields: SheetField[] = [
  { name: "name", label: "Название", type: "text", required: true },
  {
    name: "type",
    label: "Тип",
    type: "select",
    required: true,
    options: [
      { value: "LEGAL_ENTITY", label: "Юридическое лицо" },
      { value: "SOLE_PROPRIETOR", label: "ИП" },
    ],
  },
  { name: "inn", label: "ИНН", type: "text" },
  { name: "status", label: "Статус", type: "select", options: [{ value: "active", label: "Активный" }], defaultValue: "active" },
  { name: "isIntermediary", label: "Посредник", type: "checkbox" },
  { name: "amount", label: "Сумма", type: "number" },
  { name: "startDate", label: "Дата начала", type: "date" },
];

describe("buildExportRows", () => {
  it("uses field labels as headers plus an archive-status column", () => {
    const [header] = buildExportRows(fields, []);
    expect(header).toEqual(["Название", "Тип", "ИНН", "Статус", "Посредник", "Сумма", "Дата начала", ARCHIVE_COLUMN_LABEL]);
  });

  it("renders select values as labels, booleans as да/нет, dates as ISO, empty as blank", () => {
    const [, row] = buildExportRows(fields, [
      {
        name: "ООО Ромашка",
        type: "LEGAL_ENTITY",
        inn: null,
        status: "active",
        isIntermediary: true,
        amount: "1500.50",
        startDate: new Date(Date.UTC(2026, 8, 1)),
        isArchived: false,
      },
    ]);
    expect(row).toEqual(["ООО Ромашка", "Юридическое лицо", "", "Активный", "да", 1500.5, "2026-09-01", "Активна"]);
  });
});

describe("parseImportRows", () => {
  const headers = ["Название *", "тип", "ИНН", "Посредник", "Сумма", "Дата начала", "Лишняя колонка"];

  it("round-trips an export: maps labels back to values and ignores unknown columns", () => {
    const result = parseImportRows(fields, headers, [["ООО Ромашка", "Юридическое лицо", "7701234567", "да", "1 500,50", "01.09.2026", "x"]]);
    expect(result.errors).toEqual([]);
    expect(result.records).toEqual([
      {
        name: "ООО Ромашка",
        type: "LEGAL_ENTITY",
        inn: "7701234567",
        status: "active",
        isIntermediary: true,
        amount: 1500.5,
        startDate: new Date(Date.UTC(2026, 8, 1)),
      },
    ]);
  });

  it("leaves empty optional fields undefined so the DB default applies", () => {
    const result = parseImportRows(fields, headers, [["ИП Иванов", "ИП", "", "", "", "", ""]]);
    expect(result.records[0].inn).toBeUndefined();
    expect(result.records[0].isIntermediary).toBe(false);
  });

  it("skips fully empty rows", () => {
    const result = parseImportRows(fields, headers, [[null, null, null, null, null, null, null], ["А", "ИП", null, null, null, null, null]]);
    expect(result.records).toHaveLength(1);
  });

  it("reports a missing required column", () => {
    const result = parseImportRows(fields, ["Название"], [["А"]]);
    expect(result.errors).toEqual(["В файле нет колонки «Тип»"]);
  });

  it("collects every row error with the spreadsheet line number and imports nothing", () => {
    const result = parseImportRows(fields, headers, [
      ["", "ИП", "", "", "", "", ""],
      ["Б", "АО", "", "может", "abc", "32.13.2026", ""],
    ]);
    expect(result.records).toEqual([]);
    expect(result.errors).toEqual([
      "Строка 2: поле «Название» обязательно",
      "Строка 3: «АО» — нет такого значения для поля «Тип»",
      "Строка 3: «может» в поле «Посредник» — ожидается «да» или «нет»",
      "Строка 3: «abc» в поле «Сумма» — не число",
      "Строка 3: «32.13.2026» в поле «Дата начала» — дата должна быть в виде ГГГГ-ММ-ДД или ДД.ММ.ГГГГ",
    ]);
  });

  it("refuses an ambiguous reference instead of picking one of the same-named records", () => {
    const orgField: SheetField = {
      name: "organizationId",
      label: "Организация",
      type: "select",
      required: true,
      options: [
        { value: "org-1", label: "ООО Ромашка" },
        { value: "org-2", label: "ООО Ромашка" },
        { value: "org-3", label: "ООО Лютик" },
      ],
    };
    expect(parseImportRows([orgField], ["Организация"], [["ООО Лютик"], ["org-2"]]).records).toEqual([
      { organizationId: "org-3" },
      { organizationId: "org-2" },
    ]);
    expect(parseImportRows([orgField], ["Организация"], [["ооо ромашка"]]).errors).toEqual([
      "Строка 2: «ооо ромашка» в поле «Организация» — несколько записей с таким названием, переименуйте одну из них",
    ]);
  });

  it("reports a file with a header but no data", () => {
    expect(parseImportRows(fields, headers, []).errors).toEqual(["В файле нет строк с данными"]);
  });
});
