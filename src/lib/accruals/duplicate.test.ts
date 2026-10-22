import { describe, expect, it } from "vitest";
import { documentNumberKey } from "./duplicate";

describe("documentNumberKey", () => {
  it("one number however typed: «№», spaces and case do not matter, the rest does", () => {
    expect(documentNumberKey("№ 15")).toBe(documentNumberKey("15 "));
    expect(documentNumberKey("УТ-00123")).toBe(documentNumberKey("ут-00123"));
    expect(documentNumberKey("15")).not.toBe(documentNumberKey("А-15"));
    expect(documentNumberKey("  ")).toBe("");
  });
});
