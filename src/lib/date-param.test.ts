import { describe, expect, it } from "vitest";
import { parseDateParam } from "./date-param";

describe("parseDateParam", () => {
  it("accepts real calendar dates", () => {
    expect(parseDateParam("2026-10-05")).toEqual(new Date("2026-10-05T00:00:00.000Z"));
    expect(parseDateParam("2024-02-29")).toEqual(new Date("2024-02-29T00:00:00.000Z"));
  });
  it("ignores anything else instead of failing", () => {
    for (const raw of ["garbage", "2026-13-45", "2025-02-29", "05.10.2026", "", undefined, null]) expect(parseDateParam(raw)).toBeNull();
  });
});
