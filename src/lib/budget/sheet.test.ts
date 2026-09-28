import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildBudgetSheet, monthFromHeader, parseBudgetSheet, parsePercent, scaleCells, type BudgetArticle } from "./sheet";

const articles: BudgetArticle[] = [
  { id: "rev", name: "Выручка", code: "4010", group: "Выручка" },
  { id: "rent", name: "Аренда", code: null, group: "Косвенные расходы" },
  { id: "ads", name: "Реклама", code: null, group: "Косвенные расходы" },
  { id: "ads2", name: "Реклама", code: "7020", group: "Коммерческие расходы" },
];

describe("buildBudgetSheet", () => {
  it("writes one row per article with months and the year total", () => {
    const [header, rev, rent] = buildBudgetSheet(articles.slice(0, 2), [
      { articleId: "rev", month: 1, amount: new Decimal("100000") },
      { articleId: "rev", month: 12, amount: new Decimal("50000.5") },
    ]);
    expect(header.slice(0, 4)).toEqual(["Статья", "Код", "Раздел", "Янв"]);
    expect(header.at(-1)).toBe("Итого за год");
    expect(rev).toEqual(["Выручка", "4010", "Выручка", 100000, "", "", "", "", "", "", "", "", "", "", 50000.5, 150000.5]);
    expect(rent.slice(3)).toEqual(Array(13).fill(""));
  });
});

describe("monthFromHeader", () => {
  it("recognizes short and full names and numbers", () => {
    expect(monthFromHeader("Янв")).toBe(1);
    expect(monthFromHeader("сентябрь")).toBe(9);
    expect(monthFromHeader("Мая")).toBe(5);
    expect(monthFromHeader("дек.")).toBe(12);
    expect(monthFromHeader("07")).toBe(7);
    expect(monthFromHeader("13")).toBeNull();
    expect(monthFromHeader("Итого за год")).toBeNull();
  });
});

describe("parseBudgetSheet", () => {
  const headers = ["Статья", "Код", "Раздел", "Январь", "Фев", "3", "Итого за год"];

  it("round-trips an export: finds articles by code or name, skips empty cells and the total", () => {
    const r = parseBudgetSheet(headers, [
      ["что угодно", "4010", "", "100 000", "", "1500,50", "999"],
      ["аренда", "", "", "", "20000", "", ""],
      [null, null, null, null, null, null, null],
    ], articles);
    expect(r.errors).toEqual([]);
    expect(r.articleIds).toEqual(["rev", "rent"]);
    expect(r.cells.map((c) => [c.articleId, c.month, c.amount.toFixed(2)])).toEqual([
      ["rev", 1, "100000.00"],
      ["rev", 3, "1500.50"],
      ["rent", 2, "20000.00"],
    ]);
  });

  it("reports unknown and ambiguous articles, duplicates and bad amounts with line numbers", () => {
    const r = parseBudgetSheet(headers, [
      ["Нет такой", "", "", "1", "", "", ""],
      ["Реклама", "", "", "1", "", "", ""],
      ["", "9999", "", "1", "", "", ""],
      ["Выручка", "", "", "-5", "abc", "", ""],
      ["", "4010", "", "", "", "", ""],
    ], articles);
    expect(r.errors).toEqual([
      "Строка 2: статьи «Нет такой» нет",
      "Строка 3: статей «Реклама» несколько — укажите код статьи",
      "Строка 4: статьи с кодом «9999» нет",
      "Строка 5, Янв: «-5» — сумма плана не может быть отрицательной",
      "Строка 5, Фев: «abc» — не сумма",
      "Строка 6: статья «Выручка» уже есть в строке 5",
    ]);
  });

  it("needs an article column and month columns", () => {
    expect(parseBudgetSheet(["Что-то", "Ещё"], [], articles).errors).toEqual([
      "В файле нет колонки «Статья» или «Код»",
      "В файле нет колонок месяцев (Янв … Дек)",
    ]);
  });
});

describe("copying last year's plan", () => {
  it("scales by a percent, rounding to kopecks", () => {
    const cells = [{ articleId: "rev", month: 1, amount: new Decimal("100000") }, { articleId: "rent", month: 1, amount: new Decimal("333.33") }];
    expect(scaleCells(cells, 10).map((c) => c.amount.toFixed(2))).toEqual(["110000.00", "366.66"]);
    expect(scaleCells(cells, -100).map((c) => c.amount.toFixed(2))).toEqual(["0.00", "0.00"]);
  });

  it("parses the percent field", () => {
    expect(parsePercent("")).toEqual({ value: 0 });
    expect(parsePercent("2,5")).toEqual({ value: 2.5 });
    expect(parsePercent("-5%")).toEqual({ value: -5 });
    expect(parsePercent("abc")).toHaveProperty("error");
    expect(parsePercent("-150")).toHaveProperty("error");
  });
});
