import { describe, expect, it } from "vitest";
import { activityStamp, idleVerdict, readActivityStamp, IDLE_MINUTES } from "./idle-timeout";

const secret = "x".repeat(16) + "0123456789abcdef";
const t0 = Date.UTC(2026, 9, 27, 9, 0, 0);
const min = 60_000;

describe("idle timeout", () => {
  it("a stamp reads back only for its own session and secret", () => {
    const stamp = activityStamp(t0, "session-A", secret);
    expect(readActivityStamp(stamp, "session-A", secret)).toBe(t0);
    expect(readActivityStamp(stamp, "session-B", secret)).toBeNull();
    expect(readActivityStamp(stamp, "session-A", secret.replace("x", "y"))).toBeNull();
  });
  it("an edited time or a garbled stamp does not count", () => {
    const [, mac] = activityStamp(t0, "s", secret).split(".");
    expect(readActivityStamp(`${t0 + 30 * min}.${mac}`, "s", secret)).toBeNull();
    expect(readActivityStamp("123", "s", secret)).toBeNull();
    expect(readActivityStamp(undefined, "s", secret)).toBeNull();
  });
  it("work within the limit keeps the session; a long pause ends it", () => {
    expect(idleVerdict(t0, t0 + 20_000)).toBe("fresh");
    expect(idleVerdict(t0, t0 + 5 * min)).toBe("refresh");
    expect(idleVerdict(t0, t0 + IDLE_MINUTES * min)).toBe("refresh");
    expect(idleVerdict(t0, t0 + IDLE_MINUTES * min + 1)).toBe("expired");
  });
  it("no stamp, or one from the future, ends the session", () => {
    expect(idleVerdict(null, t0)).toBe("expired");
    expect(idleVerdict(t0 + 10 * min, t0)).toBe("expired");
    expect(idleVerdict(t0 + 10_000, t0)).toBe("fresh");
  });
});
