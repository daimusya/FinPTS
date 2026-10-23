import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, formatSecretForHumans, generateTotpSecret, hotp, otpauthUrl, totpStep, verifyTotp } from "./totp";
import { consumeRecoveryCode, generateRecoveryCodes, hashRecoveryCode, looksLikeRecoveryCode } from "./recovery";
import { mfaRequiredFor } from "./policy";

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("matches the RFC 6238 test vectors (last 6 of the 8 digits)", () => {
    const secret = base32Decode(RFC_SECRET);
    expect(hotp(secret, totpStep(new Date(59_000)), 8)).toBe("94287082");
    expect(hotp(secret, totpStep(new Date(1_111_111_109_000)), 8)).toBe("07081804");
    expect(hotp(secret, totpStep(new Date(1_234_567_890_000)), 8)).toBe("89005924");
    expect(hotp(secret, totpStep(new Date(2_000_000_000_000)), 8)).toBe("69279037");
  });
  it("base32 round trip; a fresh secret is 32 characters (160 bits)", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(formatSecretForHumans("ABCDEFGH")).toBe("ABCD EFGH");
  });
  it("accepts the current code and a neighbouring one, refuses an old, reused or malformed one", () => {
    const now = new Date("2026-10-23T10:00:15Z");
    const secret = base32Decode(RFC_SECRET);
    const step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step - 2), now, null)).toBeNull();
    // The same code twice — no: the step was used.
    expect(verifyTotp(RFC_SECRET, hotp(secret, step), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", now, null)).toBeNull();
  });
  it("otpauth link carries the issuer, account and secret", () => {
    const url = otpauthUrl({ issuer: "ПРОМТЕХНОСФЕРА", account: "a@b.ru", secret: "ABCD" });
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain("secret=ABCD");
    expect(decodeURIComponent(url)).toContain("ПРОМТЕХНОСФЕРА:a@b.ru");
  });
});

describe("recovery codes", () => {
  it("ten different one-time codes; each works once, typed with or without the dash and in any case", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes.every((c) => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(c))).toBe(true);
    const hashes = codes.map(hashRecoveryCode);
    const left = consumeRecoveryCode(hashes, codes[3].toUpperCase().replace("-", ""));
    expect(left).toHaveLength(9);
    expect(consumeRecoveryCode(left!, codes[3])).toBeNull();
    expect(consumeRecoveryCode(hashes, "zzzz-zzzz")).toBeNull();
  });
  it("tells a recovery code from a code of the app", () => {
    expect(looksLikeRecoveryCode("abcd-ef23")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });
});

describe("mfaRequiredFor", () => {
  it("nobody, administrators (full access or user management) or everyone", () => {
    expect(mfaRequiredFor("none", ["admin.full"])).toBe(false);
    expect(mfaRequiredFor("admins", ["admin.full"])).toBe(true);
    expect(mfaRequiredFor("admins", ["users.manage"])).toBe(true);
    expect(mfaRequiredFor("admins", ["cash.manage"])).toBe(false);
    expect(mfaRequiredFor("all", [])).toBe(true);
  });
});
