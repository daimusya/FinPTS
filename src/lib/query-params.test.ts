import { describe, expect, it } from "vitest";
import { enumParam, oneParam, singleParams } from "./query-params";

describe("query params", () => {
  it("takes the first of repeated parameters", () => {
    expect(oneParam(["POSTED", "DRAFT"])).toBe("POSTED");
    expect(oneParam("x")).toBe("x");
    expect(oneParam(undefined)).toBeUndefined();
    expect(singleParams({ q: ["a", "b"], page: "2", none: undefined })).toEqual({ q: "a", page: "2", none: undefined });
  });
  it("keeps only allowed values of a list", () => {
    const Status = { DRAFT: "DRAFT", POSTED: "POSTED" } as const;
    expect(enumParam("POSTED", Status)).toBe("POSTED");
    expect(enumParam("FOO", Status)).toBeUndefined();
    expect(enumParam(["DRAFT", "FOO"], Status)).toBe("DRAFT");
    expect(enumParam("done", ["done", "work"] as const)).toBe("done");
  });
});
