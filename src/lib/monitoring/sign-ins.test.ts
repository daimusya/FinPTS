import { describe, expect, it } from "vitest";
import { checkSignIns, summarizeSignIns } from "./sign-ins";

const now = new Date("2026-10-26T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const people = {
  byEmail: new Map([["anna@pts.ru", "Анна"]]),
  byId: new Map([["u1", "Анна"]]),
};
const rows = (key: string, n: number, minutesAgo = 1) => Array.from({ length: n }, () => ({ email: key, createdAt: ago(minutesAgo) }));

describe("sign-in monitoring", () => {
  it("a couple of typos is fine", () => {
    const facts = summarizeSignIns(rows("anna@pts.ru", 2), now, people);
    expect(checkSignIns(facts)).toMatchObject({ status: "ok", message: "Неверных паролей за сутки: 2 — без блокировок" });
    expect(checkSignIns(summarizeSignIns([], now, people)).message).toBe("Неудачных попыток входа за сутки нет");
  });
  it("a locked account or address is a warning; unknown addresses are not named", () => {
    const facts = summarizeSignIns([...rows("anna@pts.ru", 5), ...rows("ghost@x.ru", 7), ...rows("ip:203.0.113.9", 20)], now, people);
    expect(facts).toMatchObject({ passwordFailures: 12, lockedAccounts: ["Анна"], lockedAddresses: 1 });
    const check = checkSignIns(facts);
    expect(check.status).toBe("warn");
    expect(check.message).toContain("Анна");
    expect(check.message).not.toContain("ghost");
  });
  it("an old lock that has expired is no longer reported", () => {
    expect(summarizeSignIns(rows("anna@pts.ru", 5, 120), now, people).lockedAccounts).toEqual([]);
  });
  it("wrong second-step codes three times: the password is likely known to someone else", () => {
    const check = checkSignIns(summarizeSignIns([...rows("mfa:u1", 3), ...rows("anna@pts.ru", 5)], now, people));
    expect(check.status).toBe("fail");
    expect(check.message).toContain("Анна — 3 раза");
    expect(checkSignIns(summarizeSignIns(rows("mfa:u1", 2), now, people)).status).toBe("ok");
  });
});
