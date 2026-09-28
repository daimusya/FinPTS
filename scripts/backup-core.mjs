// Pure helpers for scripts/backup.mjs — no I/O, covered by scripts/backup-core.test.ts.

/**
 * Разбирает DATABASE_URL в параметры libpq. Пароль отдаётся отдельно, чтобы
 * передать его через переменную окружения PGPASSWORD, а не в командной
 * строке (её видно в списке процессов). Параметры вроде ?schema=public
 * (их понимает Prisma, но не pg_dump) отбрасываются.
 */
export function parseDatabaseUrl(databaseUrl) {
  if (!databaseUrl) throw new Error("DATABASE_URL не задан");
  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL должен начинаться с postgresql://");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!database) throw new Error("В DATABASE_URL не указана база данных");
  return {
    host: url.hostname || "localhost",
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
  };
}

const pad = (n) => String(n).padStart(2, "0");

/** Имя файла копии: <база>_ГГГГ-ММ-ДД_ЧЧММСС.dump (время UTC — сортируется по имени). */
export function backupFileName(database, date) {
  const d = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const t = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${database}_${d}_${t}.dump`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Какие старые копии удалить, чтобы осталось не больше `keep` самых
 * свежих. Трогает только файлы ровно этого формата для этой базы — любые
 * другие файлы в папке (ручные копии, журнал) не удаляются никогда.
 */
export function selectFilesToDelete(fileNames, database, keep, suffix = ".dump") {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("Число хранимых копий должно быть целым и не меньше 1");
  const pattern = new RegExp(`^${escapeRegExp(database)}_\\d{4}-\\d{2}-\\d{2}_\\d{6}${escapeRegExp(suffix)}$`);
  const ours = fileNames.filter((name) => pattern.test(name)).sort();
  return ours.slice(0, Math.max(0, ours.length - keep));
}

/**
 * Сравнивает число строк по таблицам исходной и восстановленной базы.
 * Возвращает список расхождений (пустой — всё совпало).
 */
export function compareRowCounts(source, restored) {
  const mismatches = [];
  for (const [table, count] of Object.entries(source)) {
    if (!(table in restored)) mismatches.push(`${table}: нет в восстановленной копии`);
    else if (restored[table] !== count) mismatches.push(`${table}: ${count} в базе, ${restored[table]} в копии`);
  }
  return mismatches;
}

/**
 * Папка второй копии (BACKUP_MIRROR_DIR): другой диск, сетевая папка или
 * папка облачного диска. null — не настроена. Совпадать с основной папкой
 * нельзя — тогда это не вторая копия.
 */
export function resolveMirrorDir(raw, localDir, resolvePath, platform = process.platform) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const dir = resolvePath(value);
  const norm = (p) => (platform === "win32" ? p.toLowerCase() : p).replace(/[\\/]+$/, "");
  if (norm(dir) === norm(localDir)) {
    return { error: "BACKUP_MIRROR_DIR совпадает с основной папкой копий — укажите другой диск, сетевую или облачную папку" };
  }
  return { dir };
}

/**
 * Предупреждение, если вторая копия на том же диске, что и основная: от ошибок
 * в данных она спасёт, от потери диска — нет. Сетевые пути (\\сервер\папка)
 * и другие диски — без предупреждения. Облачная папка на том же диске
 * защищает, только пока клиент облака её синхронизирует.
 */
export function mirrorWarning(localDir, mirrorDir, platform = process.platform) {
  if (platform !== "win32") return null;
  const drive = (p) => (/^[A-Za-z]:/.test(p) ? p.slice(0, 2).toUpperCase() : null);
  const a = drive(localDir);
  const b = drive(mirrorDir);
  if (!a || !b || a !== b) return null;
  return `вторая копия на том же диске ${b} — от потери диска защищает, только если это облачная папка, которая синхронизируется`;
}
