import { describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, maskSecret } from "./secret-box";

describe("secret-box", () => {
  it("round-trips a plaintext value through encrypt/decrypt", () => {
    const original = "https://example.bitrix24.ru/rest/1/verysecrettoken/";
    const encrypted = encryptSecret(original);
    expect(encrypted).not.toContain(original);
    expect(decryptSecret(encrypted)).toBe(original);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toEqual(b);
  });

  it("fails to decrypt if the ciphertext is tampered with (GCM auth tag)", () => {
    const encrypted = encryptSecret("secret-value");
    const tampered = encrypted.slice(0, -4) + "abcd";
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("masks a secret leaving only the head and last 4 characters visible", () => {
    const masked = maskSecret("https://example.bitrix24.ru/rest/1/verysecrettoken/");
    expect(masked).toBe("https://••••••••ken/");
    expect(masked).not.toContain("verysecrettoken");
  });

  it("fully masks a short secret", () => {
    expect(maskSecret("short")).toBe("••••••••");
  });
});
