import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { decodeText, parseSpreadsheet } from "./parser";

const csv = "Полное наименование;Тип\nООО Тест;Юридическое лицо\n";
// "Тест" in Windows-1251.
const cp1251Test = Buffer.from([0xd2, 0xe5, 0xf1, 0xf2]);

describe("decodeText", () => {
  it("decodes UTF-8 with and without a BOM", () => {
    expect(decodeText(Buffer.from(csv, "utf8"))).toBe(csv);
    expect(decodeText(Buffer.from("﻿" + csv, "utf8"))).toBe(csv);
  });

  it("falls back to Windows-1251 for bytes that are not valid UTF-8", () => {
    expect(decodeText(cp1251Test)).toBe("Тест");
  });
});

describe("parseSpreadsheet (CSV)", () => {
  it("reads Cyrillic from a UTF-8 CSV without a BOM", () => {
    expect(parseSpreadsheet(Buffer.from(csv, "utf8"), "orgs.csv")).toEqual({
      headers: ["Полное наименование", "Тип"],
      rows: [["ООО Тест", "Юридическое лицо"]],
    });
  });

  it("reads Cyrillic from a Windows-1251 CSV", () => {
    const bytes = Buffer.concat([Buffer.from("Name;Kind\n", "ascii"), cp1251Test, Buffer.from(";X\n", "ascii")]);
    expect(parseSpreadsheet(bytes, "orgs.csv").rows).toEqual([["Тест", "X"]]);
  });

  it("keeps cells as text: no US-date guessing, no lost leading zeros", () => {
    const text = "Дата;ИНН;Сумма\n01.09.2026;0274062111;1 500,50\n";
    expect(parseSpreadsheet(Buffer.from(text, "utf8"), "s.csv").rows).toEqual([["01.09.2026", "0274062111", "1 500,50"]]);
  });
});

describe("parseSpreadsheet (XLSX)", () => {
  it("turns date-formatted cells into the calendar day regardless of the time zone", () => {
    const sheet: XLSX.WorkSheet = {
      "!ref": "A1:C2",
      A1: { t: "s", v: "Дата" },
      B1: { t: "s", v: "Дата и время" },
      C1: { t: "s", v: "Сумма" },
      A2: { t: "n", v: 46266, z: "dd.mm.yyyy" }, // 01.09.2026
      B2: { t: "n", v: 46266.75, z: "dd.mm.yyyy hh:mm" },
      C2: { t: "n", v: 1500.5, z: "#,##0.00" },
    };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Лист1");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    expect(parseSpreadsheet(buffer, "s.xlsx").rows).toEqual([["2026-09-01", "2026-09-01", 1500.5]]);
  });
});
