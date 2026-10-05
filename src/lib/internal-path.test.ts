import { describe, expect, it } from "vitest";
import { isInternalPath } from "./internal-path";

describe("isInternalPath", () => {
  it("accepts app paths", () => {
    expect(isInternalPath("/payment-requests/c1")).toBe(true);
    expect(isInternalPath("/cash/transactions?status=NEW")).toBe(true);
  });
  it("refuses other sites and anything odd", () => {
    expect(isInternalPath("//evil.example")).toBe(false);
    expect(isInternalPath("/\\evil.example")).toBe(false);
    expect(isInternalPath("https://evil.example")).toBe(false);
    expect(isInternalPath("payment-requests")).toBe(false);
    expect(isInternalPath("/ok\r\nSet-Cookie: x")).toBe(false);
    expect(isInternalPath(null)).toBe(false);
  });
});
