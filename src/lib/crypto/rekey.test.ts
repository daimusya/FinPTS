import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNREADABLE_SECRET, decryptSecret, encryptSecret, reencryptSecret, tryDecryptSecret } from "./secret-box";
import { rekeyConfig } from "./rekey";

const OLD = "old-secret-old-secret-old-secret-0123456789";
const NEW = "new-secret-new-secret-new-secret-9876543210";

describe("re-encryption for a new AUTH_SECRET", () => {
  beforeEach(() => vi.stubEnv("AUTH_SECRET", OLD));
  afterEach(() => vi.unstubAllEnvs());

  it("a value encrypted with the old secret reads with the new one", () => {
    const payload = encryptSecret("dadata-key");
    const moved = reencryptSecret(payload, OLD, NEW);
    vi.stubEnv("AUTH_SECRET", NEW);
    expect(decryptSecret(moved)).toBe("dadata-key");
    // With a wrong old secret nothing is silently replaced.
    expect(() => reencryptSecret(payload, "wrong-secret-wrong-secret-wrong-secret", NEW)).toThrow();
  });

  it("every *Enc field of an integration config, at any depth; the rest untouched", () => {
    const config = { isEnabled: true, smtp: { host: "smtp.ru", passwordEnc: encryptSecret("p") }, telegram: { tokenEnc: encryptSecret("t") }, webhookUrlEnc: encryptSecret("w"), emptyEnc: "" };
    const { value, count } = rekeyConfig(config, OLD, NEW);
    expect(count).toBe(3);
    vi.stubEnv("AUTH_SECRET", NEW);
    const v = value as typeof config;
    expect([decryptSecret(v.smtp.passwordEnc), decryptSecret(v.telegram.tokenEnc), decryptSecret(v.webhookUrlEnc)]).toEqual(["p", "t", "w"]);
    expect(v.smtp.host).toBe("smtp.ru");
    expect(v.isEnabled).toBe(true);
    expect(v.emptyEnc).toBe("");
  });
});

describe("a value stored under another AUTH_SECRET", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("reads as null for display and fails with a message a person can act on", () => {
    vi.stubEnv("AUTH_SECRET", OLD);
    const payload = encryptSecret("telegram-token");
    vi.stubEnv("AUTH_SECRET", NEW);
    expect(tryDecryptSecret(payload)).toBeNull();
    expect(() => decryptSecret(payload)).toThrow(UNREADABLE_SECRET);
    vi.stubEnv("AUTH_SECRET", OLD);
    expect(tryDecryptSecret(payload)).toBe("telegram-token");
  });
});
