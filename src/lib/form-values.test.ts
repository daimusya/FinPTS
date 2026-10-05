import { describe, expect, it } from "vitest";
import { parseFormAmount, parseFormDate, yearProblem } from "./form-values";

describe("parseFormDate", () => {
  it("accepts real dates in a sensible range", () => {
    expect(parseFormDate("2026-10-05", "Дата документа")).toEqual({ date: new Date("2026-10-05T00:00:00.000Z") });
  });
  it("catches typos in the year and malformed input", () => {
    expect(parseFormDate("0202-10-05", "Дата документа")).toEqual({ error: "Дата документа: 202 год — похоже на опечатку (допустимо 2000–2100)" });
    expect(parseFormDate("2202-01-01", "Дата документа")).toMatchObject({ error: expect.stringMatching(/2202 год/) });
    expect(parseFormDate("2026-02-30", "Дата документа")).toMatchObject({ error: expect.stringMatching(/не дата/) });
    expect(parseFormDate("", "Дата документа")).toEqual({ error: "Заполните поле «Дата документа»" });
    expect(parseFormDate(null, "Дата документа")).toEqual({ error: "Заполните поле «Дата документа»" });
  });
});

describe("parseFormAmount", () => {
  it("accepts amounts written the Russian way", () => {
    expect(parseFormAmount("1 234,56")).toEqual({ value: "1234.56" });
    expect(parseFormAmount("5000")).toEqual({ value: "5000" });
    expect(parseFormAmount("0.5")).toEqual({ value: "0.5" });
    expect(parseFormAmount("007")).toEqual({ value: "7" });
  });
  it("refuses non-numbers, zero, negatives, extra decimals and absurd sizes", () => {
    expect(parseFormAmount("abc")).toMatchObject({ error: expect.stringMatching(/нужно число/) });
    expect(parseFormAmount("0")).toEqual({ error: "Сумма должна быть больше нуля" });
    expect(parseFormAmount("-5")).toMatchObject({ error: expect.stringMatching(/нужно число/) });
    expect(parseFormAmount("1.234")).toMatchObject({ error: expect.stringMatching(/двух знаков/) });
    expect(parseFormAmount("1e9")).toMatchObject({ error: expect.stringMatching(/нужно число/) });
    expect(parseFormAmount("99999999999999999999")).toEqual({ error: "Сумма слишком большая" });
    expect(parseFormAmount("")).toEqual({ error: "Сумма: укажите" });
  });
});

describe("yearProblem", () => {
  it("flags years outside 2000–2100", () => {
    expect(yearProblem("2026-01-01")).toBeNull();
    expect(yearProblem("0202-01-01")).toBe("202 год — похоже на опечатку (допустимо 2000–2100)");
    expect(yearProblem("9999-12-31")).toMatch(/9999 год/);
  });
});
