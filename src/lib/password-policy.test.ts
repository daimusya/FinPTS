import { describe, expect, it } from "vitest";
import { sessionIssuedBeforePasswordChange, validateNewPassword } from "./password-policy";

describe("validateNewPassword", () => {
  const base = { password: "Krokus2026x", repeat: "Krokus2026x", email: "anna.petrova@example.ru", current: "Old-pass-1" };
  it("accepts a long password with letters and digits", () => {
    expect(validateNewPassword(base)).toBeNull();
    expect(validateNewPassword({ ...base, password: "подснежник7мая", repeat: "подснежник7мая" })).toBeNull();
  });
  it("refuses short, letters-only, digits-only, mismatched, e-mail based and unchanged passwords", () => {
    expect(validateNewPassword({ ...base, password: "Ab1", repeat: "Ab1" })).toMatch(/не короче 10/);
    expect(validateNewPassword({ ...base, password: "onlyletters", repeat: "onlyletters" })).toMatch(/буквы, и цифры/);
    expect(validateNewPassword({ ...base, password: "1234567890", repeat: "1234567890" })).toMatch(/буквы, и цифры/);
    expect(validateNewPassword({ ...base, repeat: "Krokus2026y" })).toMatch(/не совпадают/);
    expect(validateNewPassword({ ...base, password: "anna.petrova99", repeat: "anna.petrova99" })).toMatch(/почту/);
    expect(validateNewPassword({ ...base, password: "Old-pass-1x", repeat: "Old-pass-1x", current: "Old-pass-1x" })).toMatch(/совпадает с текущим/);
  });
});

describe("sessionIssuedBeforePasswordChange", () => {
  const changed = new Date("2026-10-05T10:00:00.700Z");
  it("ends sessions issued before the change, keeps the one issued in the same second and later", () => {
    expect(sessionIssuedBeforePasswordChange(Math.floor(changed.getTime() / 1000) - 1, changed)).toBe(true);
    expect(sessionIssuedBeforePasswordChange(Math.floor(changed.getTime() / 1000), changed)).toBe(false);
    expect(sessionIssuedBeforePasswordChange(Math.floor(changed.getTime() / 1000) + 60, changed)).toBe(false);
  });
  it("never changed — every session is valid; a token without issue time is not", () => {
    expect(sessionIssuedBeforePasswordChange(1, null)).toBe(false);
    expect(sessionIssuedBeforePasswordChange(undefined, changed)).toBe(true);
  });
});
