import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mirrorWarning, resolveMirrorDir, selectFilesToDelete } from "./backup-core.mjs";
import { decryptFile, encryptFile, sha256File } from "./backup-crypto.mjs";

const winResolve = (p: string) => (/^[A-Za-z]:|^\\\\/.test(p) ? p : `C:\\Users\\User\\Documents\\фп\\${p}`);

describe("resolveMirrorDir", () => {
  const local = "C:\\Users\\User\\Documents\\фп\\backups";

  it("is off when not configured and refuses the main backup folder itself", () => {
    expect(resolveMirrorDir("", local, winResolve, "win32")).toBeNull();
    expect(resolveMirrorDir("  ", local, winResolve, "win32")).toBeNull();
    expect(resolveMirrorDir("backups", local, winResolve, "win32")).toHaveProperty("error");
    expect(resolveMirrorDir("C:\\USERS\\User\\Documents\\фп\\backups\\", local, winResolve, "win32")).toHaveProperty("error");
  });

  it("accepts another disk, a network share or a cloud folder", () => {
    expect(resolveMirrorDir("D:\\backups", local, winResolve, "win32")).toEqual({ dir: "D:\\backups" });
    expect(resolveMirrorDir("\\\\nas\\backups", local, winResolve, "win32")).toEqual({ dir: "\\\\nas\\backups" });
  });
});

describe("mirrorWarning", () => {
  it("warns only when both copies are on the same Windows drive", () => {
    expect(mirrorWarning("C:\\app\\backups", "C:\\Users\\User\\OneDrive\\backups", "win32")).toContain("том же диске C:");
    expect(mirrorWarning("C:\\app\\backups", "D:\\backups", "win32")).toBeNull();
    expect(mirrorWarning("C:\\app\\backups", "\\\\nas\\backups", "win32")).toBeNull();
    expect(mirrorWarning("/srv/backups", "/mnt/nas", "linux")).toBeNull();
  });
});

describe("selectFilesToDelete for encrypted copies", () => {
  it("rotates .dump.enc files separately from plain dumps", () => {
    const files = ["db_2026-09-20_030000.dump.enc", "db_2026-09-21_030000.dump.enc", "db_2026-09-21_030000.dump", "notes.txt"];
    expect(selectFilesToDelete(files, "db", 1, ".dump.enc")).toEqual(["db_2026-09-20_030000.dump.enc"]);
    expect(selectFilesToDelete(files, "db", 1)).toEqual([]);
  });
});

describe("encrypted mirror copy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-crypto-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const password = "correct horse battery staple";

  it("round-trips a file: the decrypted copy has the original SHA-256", async () => {
    const src = path.join(dir, "db.dump");
    fs.writeFileSync(src, Buffer.concat([Buffer.from("PGDMP"), Buffer.alloc(300_000, 7), Buffer.from("конец")]));
    const enc = path.join(dir, "db.dump.enc");
    const plainHash = await encryptFile(src, enc, password);
    expect(plainHash).toBe(await sha256File(src));
    expect(fs.readFileSync(enc).subarray(0, 6).toString()).toBe("PTSBK1");
    expect(fs.readFileSync(enc).includes(Buffer.from("PGDMP"))).toBe(false);
    expect(await decryptFile(enc, null, password)).toBe(plainHash);
    const out = path.join(dir, "restored.dump");
    await decryptFile(enc, out, password);
    expect(await sha256File(out)).toBe(plainHash);
  });

  it("refuses a wrong password, a damaged file, a plain file and a short password", async () => {
    const src = path.join(dir, "small.dump");
    fs.writeFileSync(src, "данные");
    const enc = path.join(dir, "small.dump.enc");
    await encryptFile(src, enc, password);
    await expect(decryptFile(enc, null, "wrong password 123")).rejects.toThrow("Неверный пароль или файл повреждён");
    const damaged = fs.readFileSync(enc);
    damaged[40] ^= 0xff;
    fs.writeFileSync(enc, damaged);
    await expect(decryptFile(enc, null, password)).rejects.toThrow("Неверный пароль или файл повреждён");
    fs.writeFileSync(path.join(dir, "plain.dump"), Buffer.alloc(100, 1));
    await expect(decryptFile(path.join(dir, "plain.dump"), null, password)).rejects.toThrow("PTSBK1");
    await expect(encryptFile(src, path.join(dir, "x.enc"), "short")).rejects.toThrow("не короче 12");
  });
});
