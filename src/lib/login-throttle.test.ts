import { describe, expect, it } from "vitest";
import { MAX_IP_FAILURES, clientIp, lockedMinutes, lockedMinutesFor } from "./login-throttle";

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

describe("per-address limit and client address", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it("one computer: twenty failures in 15 minutes over any addresses lock it, nineteen do not", () => {
    expect(lockedMinutesFor(Array.from({ length: 19 }, (_, i) => ago(i % 10)), now, MAX_IP_FAILURES)).toBe(0);
    expect(lockedMinutesFor(Array.from({ length: 20 }, (_, i) => ago(i % 10)), now, MAX_IP_FAILURES)).toBe(15);
  });
  it("the client is the first address the proxy wrote; without a proxy — the real-ip header or nothing", () => {
    expect(clientIp("203.0.113.7, 10.0.0.2", null)).toBe("203.0.113.7");
    expect(clientIp(null, " 198.51.100.4 ")).toBe("198.51.100.4");
    expect(clientIp("", null)).toBeNull();
  });
});
