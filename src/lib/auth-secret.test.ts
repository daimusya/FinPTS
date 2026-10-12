import { describe, expect, it } from "vitest";
import { EXAMPLE_SECRET, isUnusableSecret, secretWeakness } from "./auth-secret";

describe("secretWeakness", () => {
  it("accepts a long random secret", () => {
    expect(secretWeakness("k3J9xQ2mZr8T1vW5yB7nC4pL6sD0fG2hKa9Uq3E")).toBeNull();
  });
  it("refuses the example, missing and very short secrets outright", () => {
    expect(secretWeakness(EXAMPLE_SECRET)).toBe("example");
    expect(secretWeakness("changeme-please-1234567890-abcdefgh")).toBe("example");
    expect(secretWeakness(undefined)).toBe("missing");
    expect(secretWeakness("short123")).toBe("too_short");
    expect(isUnusableSecret("example")).toBe(true);
    expect(isUnusableSecret("too_short")).toBe(true);
  });
  it("only warns about secrets that are short-ish or monotonous", () => {
    expect(secretWeakness("abcdefghij0123456789xyz")).toBe("short");
    expect(secretWeakness("aaaaaaaaaabbbbbbbbbbccccccccccdddddddddd")).toBe("simple");
    expect(isUnusableSecret("short")).toBe(false);
    expect(isUnusableSecret("simple")).toBe(false);
  });
});
