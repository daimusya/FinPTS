import { describe, expect, it } from "vitest";
import { backupFileName, compareRowCounts, parseDatabaseUrl, selectFilesToDelete } from "./backup-core.mjs";

describe("parseDatabaseUrl", () => {
  it("splits the Prisma URL into libpq parameters and drops ?schema", () => {
    expect(parseDatabaseUrl("postgresql://app%40x:p%40ss@db.local:6543/promtehnosfera?schema=public")).toEqual({
      host: "db.local",
      port: "6543",
      user: "app@x",
      password: "p@ss",
      database: "promtehnosfera",
    });
    expect(parseDatabaseUrl("postgres://u:p@localhost/fin").port).toBe("5432");
  });

  it("rejects a missing or non-PostgreSQL URL", () => {
    expect(() => parseDatabaseUrl(undefined)).toThrow("DATABASE_URL");
    expect(() => parseDatabaseUrl("mysql://u:p@h/db")).toThrow("postgresql://");
    expect(() => parseDatabaseUrl("postgresql://u:p@h/")).toThrow("база данных");
  });
});

describe("backupFileName", () => {
  it("uses a sortable UTC timestamp", () => {
    expect(backupFileName("promtehnosfera", new Date(Date.UTC(2026, 8, 24, 3, 5, 9)))).toBe("promtehnosfera_2026-09-24_030509.dump");
  });
});

describe("selectFilesToDelete", () => {
  const files = [
    "promtehnosfera_2026-09-20_030000.dump",
    "promtehnosfera_2026-09-22_030000.dump",
    "promtehnosfera_2026-09-21_030000.dump",
    "promtehnosfera_2026-09-23_030000.dump",
    "backup.log",
    "manual-before-migration.dump",
    "other_2026-01-01_000000.dump",
  ];

  it("keeps the newest copies of this database and never touches other files", () => {
    expect(selectFilesToDelete(files, "promtehnosfera", 2)).toEqual([
      "promtehnosfera_2026-09-20_030000.dump",
      "promtehnosfera_2026-09-21_030000.dump",
    ]);
    expect(selectFilesToDelete(files, "promtehnosfera", 10)).toEqual([]);
  });

  it("refuses to keep fewer than one copy", () => {
    expect(() => selectFilesToDelete(files, "promtehnosfera", 0)).toThrow();
  });
});

describe("compareRowCounts", () => {
  it("lists tables whose row counts differ or that are missing", () => {
    expect(compareRowCounts({ users: 1, audit_log: 10, periods: 2 }, { users: 1, audit_log: 9 })).toEqual([
      "audit_log: 10 в базе, 9 в копии",
      "periods: нет в восстановленной копии",
    ]);
    expect(compareRowCounts({ users: 1 }, { users: 1 })).toEqual([]);
  });
});
