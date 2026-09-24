import { describe, expect, it } from "vitest";
import { backupFreshness } from "./status";

const now = new Date("2026-09-24T12:00:00Z");

describe("backupFreshness", () => {
  it("is ok within 26 hours and stale after", () => {
    expect(backupFreshness(new Date("2026-09-24T03:00:00Z"), now)).toEqual({ state: "ok", ageHours: 9 });
    expect(backupFreshness(new Date("2026-09-23T10:00:00Z"), now)).toEqual({ state: "ok", ageHours: 26 });
    expect(backupFreshness(new Date("2026-09-23T09:30:00Z"), now)).toEqual({ state: "stale", ageHours: 26.5 });
  });

  it("reports never when there is no successful backup", () => {
    expect(backupFreshness(null, now)).toEqual({ state: "never", ageHours: null });
  });
});
