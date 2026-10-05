import { describe, expect, it } from "vitest";
import { dictionarySearchWhere } from "./search";

describe("dictionarySearchWhere", () => {
  it("looks for the query in every text column, case-insensitively", () => {
    expect(dictionarySearchWhere(["fullName", "inn"], "ромашка")).toEqual({
      OR: [{ fullName: { contains: "ромашка", mode: "insensitive" } }, { inn: { contains: "ромашка", mode: "insensitive" } }],
    });
  });
  it("every word must match somewhere", () => {
    expect(dictionarySearchWhere(["name"], " Ромашка   7701 ")).toEqual({
      AND: [{ OR: [{ name: { contains: "Ромашка", mode: "insensitive" } }] }, { OR: [{ name: { contains: "7701", mode: "insensitive" } }] }],
    });
  });
  it("no query or no text columns — no condition", () => {
    expect(dictionarySearchWhere(["name"], "  ")).toEqual({});
    expect(dictionarySearchWhere(["name"], undefined)).toEqual({});
    expect(dictionarySearchWhere([], "x")).toEqual({});
  });
});
