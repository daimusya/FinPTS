import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { editVersion, versionMatches } from "./edit-version";

describe("editVersion", () => {
  const fields = ["name", "rate", "since"];
  it("is stable for equal values regardless of their form", () => {
    const a = editVersion({ name: "Склад", rate: new Prisma.Decimal("20.00"), since: new Date("2026-01-01T00:00:00Z") }, fields);
    const b = editVersion({ name: "Склад", rate: "20", since: "2026-01-01T00:00:00.000Z", other: 1 }, fields);
    expect(a).toHaveLength(20);
    expect(editVersion({ name: "Склад", rate: 20, since: null }, fields)).toBe(editVersion({ name: "Склад", rate: "20", since: "" }, fields));
    expect(a).not.toBe(editVersion({ name: "Склад", rate: "20.5", since: new Date("2026-01-01T00:00:00Z") }, fields));
    expect(typeof b).toBe("string");
  });
  it("ignores fields the form does not edit", () => {
    expect(editVersion({ name: "A", notifyEmail: true }, ["name"])).toBe(editVersion({ name: "A", notifyEmail: false }, ["name"]));
  });
});

describe("versionMatches", () => {
  it("matches the same version, refuses another, skips forms without one", () => {
    expect(versionMatches("abc", "abc")).toBe(true);
    expect(versionMatches("abc", "xyz")).toBe(false);
    expect(versionMatches(null, "xyz")).toBe(true);
    expect(versionMatches("", "xyz")).toBe(true);
  });
});
