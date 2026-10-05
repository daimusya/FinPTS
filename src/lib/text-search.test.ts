import { describe, expect, it } from "vitest";
import { textSearchWhere } from "./text-search";

describe("textSearchWhere", () => {
  it("searches own and related fields", () => {
    expect(textSearchWhere(["purpose", "counterparty.inn"], "7701")).toEqual({
      OR: [{ purpose: { contains: "7701", mode: "insensitive" } }, { counterparty: { inn: { contains: "7701", mode: "insensitive" } } }],
    });
  });
  it("every word must match somewhere; empty query — no condition", () => {
    expect(textSearchWhere(["number"], "акт 15")).toEqual({
      AND: [{ OR: [{ number: { contains: "акт", mode: "insensitive" } }] }, { OR: [{ number: { contains: "15", mode: "insensitive" } }] }],
    });
    expect(textSearchWhere(["number"], " ")).toEqual({});
    expect(textSearchWhere([], "x")).toEqual({});
  });
});
