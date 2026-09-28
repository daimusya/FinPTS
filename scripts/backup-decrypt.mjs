#!/usr/bin/env node
// Расшифровка второй копии: npm run db:backup:decrypt -- <файл.dump.enc> [<куда.dump>]
// Пароль — из BACKUP_MIRROR_PASSWORD (переменная окружения или .env). Результат —
// обычный файл pg_dump, который восстанавливается pg_restore (см. README).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decryptFile } from "./backup-crypto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.BACKUP_MIRROR_PASSWORD && fs.existsSync(path.join(ROOT, ".env"))) {
  const line = fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).find((l) => /^\s*BACKUP_MIRROR_PASSWORD\s*=/.test(l));
  if (line) process.env.BACKUP_MIRROR_PASSWORD = line.replace(/^[^=]*=\s*/, "").replace(/^(["'])(.*)\1$/, "$2");
}

const [src, destArg] = process.argv.slice(2);
if (!src) {
  console.error("Укажите файл: npm run db:backup:decrypt -- <файл.dump.enc> [<куда.dump>]");
  process.exit(1);
}
const dest = destArg || src.replace(/\.enc$/, "") + (src.endsWith(".enc") ? "" : ".decrypted");
if (fs.existsSync(dest)) {
  console.error(`Файл ${dest} уже есть — укажите другое имя`);
  process.exit(1);
}
try {
  const hash = await decryptFile(src, dest, process.env.BACKUP_MIRROR_PASSWORD || "");
  console.log(`Расшифровано: ${dest} (SHA-256 ${hash})`);
} catch (error) {
  console.error(`Не удалось расшифровать: ${error.message}`);
  process.exit(1);
}
