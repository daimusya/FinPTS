import { describe, expect, it } from "vitest";
import { describeRows, groupOnecRows } from "./onec-grouping";
import type { OnecColumnMapping } from "./onec-mapping";

// externalId | orgInn | cpInn | type | direction | number | date | amount | vat | article | line text | project
const mapping: OnecColumnMapping = {
  0: "externalId",
  1: "organizationInn",
  2: "counterpartyInn",
  3: "documentType",
  4: "direction",
  5: "number",
  6: "date",
  7: "amount",
  8: "vatAmount",
  9: "pnlArticleCode",
  10: "lineDescription",
  11: "projectName",
};
const row = (id: string, amount: number | null, article: string | null, header = true, extra: Partial<Record<number, string>> = {}) => {
  const base: Array<string | number | null> = header
    ? [id, "7700000000", "7701234567", "ACT", "INCOME", "АКТ-1", "15.09.2026", amount, null, article, null, null]
    : [id, null, null, null, null, null, null, amount, null, article, null, null];
  for (const [i, v] of Object.entries(extra)) base[Number(i)] = v ?? null;
  return base;
};

describe("groupOnecRows", () => {
  it("joins rows with the same external ID into one multi-line document, header taken from any row", () => {
    const { documents, errors } = groupOnecRows(
      [
        row("DOC-1", 100000, "Выручка", true, { 10: "Обучение ОТ", 11: "Проект А" }),
        row("DOC-1", 50000, "Выручка", false, { 10: "Аудит СОУТ" }),
        row("DOC-2", 7000, "Прочие доходы"),
        row("DOC-1", 3000, "Прочие доходы", false),
      ],
      mapping,
    );
    expect(errors).toEqual([]);
    expect(documents.map((d) => [d.externalId, d.rowNumbers, d.lines.length])).toEqual([
      ["DOC-1", [2, 3, 5], 3],
      ["DOC-2", [4], 1],
    ]);
    const doc1 = documents[0];
    expect(doc1.header).toMatchObject({ number: "АКТ-1", documentType: "ACT", direction: "INCOME", organizationInn: "7700000000" });
    expect(doc1.lines.map((l) => [l.amount, l.pnlArticleCode, l.description, l.projectName])).toEqual([
      [100000, "Выручка", "Обучение ОТ", "Проект А"],
      [50000, "Выручка", "Аудит СОУТ", null],
      [3000, "Прочие доходы", null, null],
    ]);
  });

  it("rejects the whole document when header values differ between its rows", () => {
    const { documents, errors } = groupOnecRows(
      [row("DOC-1", 100, "Выручка"), row("DOC-1", 200, "Выручка", true, { 6: "16.09.2026" })],
      mapping,
    );
    expect(documents).toEqual([]);
    expect(errors).toEqual([{ externalId: "DOC-1", rowNumbers: [2, 3], message: "поле «дата» различается в строках 2 и 3" }]);
  });

  it("rejects the whole document when one of its lines has no amount or article", () => {
    const { documents, errors } = groupOnecRows([row("DOC-1", 100, "Выручка"), row("DOC-1", null, "Выручка", false)], mapping);
    expect(documents).toEqual([]);
    expect(errors[0].message).toBe("в строке 3 нет суммы или статьи ОПиУ");
  });

  it("reports rows without an external ID, skips blank rows and validates the header", () => {
    const blank = Array(12).fill(null);
    const noId = row("", 100, "Выручка");
    const badType = row("DOC-9", 100, "Выручка", true, { 3: "BILL" });
    const { documents, errors } = groupOnecRows([blank, noId, badType], mapping);
    expect(documents).toEqual([]);
    expect(errors.map((e) => [e.rowNumbers, e.message])).toEqual([
      [[3], "не указан внешний ID документа 1С"],
      [[4], "неизвестный тип документа «BILL»"],
    ]);
  });
});

describe("describeRows", () => {
  it("formats single, contiguous and scattered row numbers", () => {
    expect(describeRows([5])).toBe("строка 5");
    expect(describeRows([2, 3, 4])).toBe("строки 2–4");
    expect(describeRows([2, 5, 9])).toBe("строки 2, 5, 9");
  });
});
