import { describe, expect, it } from "vitest";
import { parseCellMonth, parseScenarioCell } from "./cell-value";

describe("parseScenarioCell", () => {
  it("accepts numbers written the Russian way", () => {
    expect(parseScenarioCell("1 500,5")).toEqual({ value: "1500.5" });
    expect(parseScenarioCell("12.3456")).toEqual({ value: "12.3456" });
    expect(parseScenarioCell("0")).toEqual({ value: "0" });
  });
  it("explains what is wrong instead of dropping the cell", () => {
    expect(parseScenarioCell("1.2.3")).toEqual({ error: "«1.2.3» — не число" });
    expect(parseScenarioCell("-5")).toEqual({ error: "«-5» — не может быть меньше нуля" });
    expect(parseScenarioCell("1e30")).toEqual({ error: "«1e30» — не число" });
    expect(parseScenarioCell("Infinity")).toEqual({ error: "«Infinity» — не число" });
    expect(parseScenarioCell("1,23456")).toEqual({ error: "«1,23456» — не больше 4 знаков после запятой" });
    expect(parseScenarioCell("999999999999999")).toEqual({ error: "«999999999999999» — слишком большое число" });
  });
});

describe("parseCellMonth", () => {
  it("reads a sensible year and month", () => {
    expect(parseCellMonth("2027_3")).toEqual({ year: 2027, month: 3 });
    expect(parseCellMonth("2027_13")).toBeNull();
    expect(parseCellMonth("abc_1")).toBeNull();
    expect(parseCellMonth("1900_1")).toBeNull();
  });
});
