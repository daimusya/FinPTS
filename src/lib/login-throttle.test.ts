import { describe, expect, it } from "vitest";
import { lockedMinutes } from "./login-throttle";

const now = new Date("2026-10-02T10:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("lockedMinutes", () => {
  it("lets four failures through", () => {
    expect(lockedMinutes([1, 2, 3, 4].map(minutesAgo), now)).toBe(0);
  });

  it("locks for 15 minutes after the fifth failure within 15 minutes", () => {
    expect(lockedMinutes([0, 1, 2, 3, 4].map(minutesAgo), now)).toBe(15);
    expect(lockedMinutes([6, 7, 8, 9, 10].map(minutesAgo), now)).toBe(9);
  });

  it("forgets failures older than 15 minutes and lifts the lock after 15 minutes", () => {
    expect(lockedMinutes([1, 2, 3, 4, 20].map(minutesAgo), now)).toBe(0);
    // Five failures 16–20 minutes ago: outside the window, no lock.
    expect(lockedMinutes([16, 17, 18, 19, 20].map(minutesAgo), now)).toBe(0);
  });
});
