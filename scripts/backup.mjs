#!/usr/bin/env node
// Резервное копирование базы: npm run db:backup [-- --verify-restore]
//
// 1. pg_dump в сжатом формате custom во временный файл, затем переименование —
//    незавершённая копия никогда не выглядит готовой.
// 2. Проверка архива через pg_restore --list (читается, есть таблицы).
// 3. С --verify-restore (или BACKUP_VERIFY_RESTORE=1): восстановление во временную
//    базу <имя>_restore_check, сверка числа строк по всем таблицам, удаление базы.
// 4. Ротация: хранятся BACKUP_KEEP (по умолчанию 14) последних копий.
// 5. Запись результата в таблицу backup_runs (страница «Резервные копии», /api/health)
//    и строка в backups/backup.log — даже если сама база недоступна.
//
// Пароль передаётся pg_dump/pg_restore через PGPASSWORD, не в командной строке.
// Настройки: DATABASE_URL, BACKUP_DIR, BACKUP_KEEP, PG_BIN_DIR (папка с pg_dump).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backupFileName, compareRowCounts, parseDatabaseUrl, selectFilesToDelete } from "./backup-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnv() {
  // Next.js and Prisma read .env themselves; a plain Node script does not.
  if (process.env.DATABASE_URL) return;
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

function findPgBinary(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  if (process.env.PG_BIN_DIR) return path.join(process.env.PG_BIN_DIR, exe);
  if (process.platform === "win32") {
    // The Windows installer does not add PostgreSQL to PATH — take the newest installed version.
    const base = "C:\\Program Files\\PostgreSQL";
    if (fs.existsSync(base)) {
      const versions = fs
        .readdirSync(base)
        .filter((v) => fs.existsSync(path.join(base, v, "bin", exe)))
        .sort((a, b) => Number(b) - Number(a));
      if (versions.length > 0) return path.join(base, versions[0], "bin", exe);
    }
  }
  return exe; // rely on PATH
}

// PostgreSQL tools on Windows print localized messages in the ANSI code page, not UTF-8.
function decode(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1251").decode(buffer);
  }
}

const oneLine = (text) => text.replace(/\s+/g, " ").trim();

function run(command, args, env) {
  return new Promise((resolve) => {
    // English messages are plain ASCII whatever the console encoding.
    const child = spawn(command, args, { env: { ...env, LC_ALL: "C", LC_MESSAGES: "C", LANG: "C" }, windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (error) => resolve({ code: -1, stdout: "", stderr: String(error.message) }));
    child.on("close", (code) => resolve({ code, stdout: decode(Buffer.concat(out)), stderr: decode(Buffer.concat(err)) }));
  });
}

function appendLog(dir, line) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "backup.log"), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // The log is a convenience; the exit code is what schedulers act on.
  }
}

async function countRows(client) {
  const tables = await client.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
  );
  const counts = {};
  for (const { table_name: table } of tables) {
    const [{ count }] = await client.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "${table.replace(/"/g, '""')}"`);
    counts[table] = count;
  }
  return counts;
}

async function main() {
  loadDotEnv();
  const verifyRestore = process.argv.includes("--verify-restore") || process.env.BACKUP_VERIFY_RESTORE === "1";
  const dir = path.resolve(ROOT, process.env.BACKUP_DIR || "backups");
  const keep = Number(process.env.BACKUP_KEEP || 14);
  const conn = parseDatabaseUrl(process.env.DATABASE_URL);
  const pgEnv = { ...process.env, PGHOST: conn.host, PGPORT: conn.port, PGUSER: conn.user, PGPASSWORD: conn.password };

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  let runId = null;
  try {
    runId = (await prisma.backupRun.create({ data: { status: "running", host: os.hostname() } })).id;
  } catch (error) {
    console.error(`Не удалось записать запуск в базу: ${error.message}`);
  }

  const finish = async (data) => {
    if (!runId) return;
    try {
      await prisma.backupRun.update({ where: { id: runId }, data: { ...data, finishedAt: new Date() } });
    } catch (error) {
      console.error(`Не удалось записать результат в базу: ${error.message}`);
    }
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    const fileName = backupFileName(conn.database, new Date());
    const target = path.join(dir, fileName);
    const partial = `${target}.partial`;

    const dump = await run(
      findPgBinary("pg_dump"),
      ["--format=custom", "--no-owner", "--no-privileges", "--file", partial, "--dbname", conn.database],
      pgEnv,
    );
    if (dump.code !== 0) {
      fs.rmSync(partial, { force: true });
      throw new Error(`pg_dump завершился с ошибкой: ${oneLine(dump.stderr) || `код ${dump.code}`}`);
    }
    fs.renameSync(partial, target);
    const sizeBytes = fs.statSync(target).size;

    const list = await run(findPgBinary("pg_restore"), ["--list", target], pgEnv);
    const tableCount = list.stdout.split(/\r?\n/).filter((l) => / TABLE public /.test(l)).length;
    if (list.code !== 0 || tableCount === 0) {
      throw new Error(`Архив не читается или пуст: ${oneLine(list.stderr) || "в оглавлении нет таблиц"}`);
    }

    let restoreCheck = null;
    let restoreDetails = null;
    if (verifyRestore) {
      const checkDb = `${conn.database}_restore_check`;
      if (!/^[A-Za-z0-9_]+$/.test(checkDb)) throw new Error(`Недопустимое имя проверочной базы: ${checkDb}`);
      await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${checkDb}"`);
      await prisma.$executeRawUnsafe(`CREATE DATABASE "${checkDb}"`);
      const checkUrl = new URL(process.env.DATABASE_URL);
      checkUrl.pathname = `/${checkDb}`;
      const checkClient = new PrismaClient({ datasourceUrl: checkUrl.toString() });
      try {
        const restore = await run(
          findPgBinary("pg_restore"),
          ["--no-owner", "--no-privileges", "--exit-on-error", "--dbname", checkDb, target],
          pgEnv,
        );
        if (restore.code !== 0) throw new Error(`pg_restore в проверочную базу: ${oneLine(restore.stderr)}`);
        const [source, restored] = await Promise.all([countRows(prisma), countRows(checkClient)]);
        const mismatches = compareRowCounts(source, restored);
        const totalRows = Object.values(restored).reduce((a, b) => a + b, 0);
        restoreCheck = mismatches.length === 0 ? "ok" : "mismatch";
        restoreDetails =
          mismatches.length === 0
            ? `Восстановлено ${Object.keys(restored).length} таблиц, ${totalRows} строк — совпадает с базой`
            : `Расхождения (данные могли меняться во время проверки): ${mismatches.join("; ")}`;
      } finally {
        await checkClient.$disconnect();
        await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${checkDb}"`);
      }
    }

    const toDelete = selectFilesToDelete(fs.readdirSync(dir), conn.database, keep);
    for (const name of toDelete) fs.rmSync(path.join(dir, name));

    await finish({
      status: "success",
      fileName,
      sizeBytes: BigInt(sizeBytes),
      tableCount,
      restoreCheck,
      restoreDetails,
      deletedOld: toDelete.length,
    });
    const summary = `OK ${fileName} ${(sizeBytes / 1024).toFixed(0)} КБ, таблиц ${tableCount}, удалено старых ${toDelete.length}${
      restoreCheck ? `, проверка восстановления: ${restoreCheck}` : ""
    }`;
    appendLog(dir, summary);
    console.log(summary);
    if (restoreDetails) console.log(restoreDetails);
  } catch (error) {
    await finish({ status: "failed", error: error.message });
    appendLog(dir, `FAILED ${error.message}`);
    console.error(`Резервное копирование не выполнено: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
