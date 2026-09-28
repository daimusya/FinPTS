// Шифрование второй копии резервной копии (BACKUP_MIRROR_PASSWORD): её можно
// держать в облачной папке, не открывая финансовую базу постороннему.
//
// Формат файла: "PTSBK1" (6 байт) | соль (16) | IV (12) | шифротекст | тег GCM (16).
// Ключ — scrypt(пароль, соль, 32 байта); шифр — AES-256-GCM (тег проверяет,
// что файл не повреждён и пароль верный).

import crypto from "node:crypto";
import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

const MAGIC = Buffer.from("PTSBK1");
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + SALT_LEN + IV_LEN;

function deriveKey(password, salt) {
  if (!password || password.length < 12) throw new Error("Пароль шифрования копии (BACKUP_MIRROR_PASSWORD) — не короче 12 символов");
  return crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
}

export async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

/** Шифрует src в dest; возвращает SHA-256 исходного файла (для сверки после расшифровки). */
export async function encryptFile(src, dest, password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  const hash = crypto.createHash("sha256");
  const tap = new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const out = fs.createWriteStream(dest);
  out.write(Buffer.concat([MAGIC, salt, iv]));
  await pipeline(fs.createReadStream(src), tap, cipher, out, { end: false });
  await new Promise((resolve, reject) => out.end(cipher.getAuthTag(), (err) => (err ? reject(err) : resolve())));
  return hash.digest("hex");
}

/**
 * Расшифровывает src в dest (или только считает SHA-256 расшифрованного, если
 * dest = null) и проверяет тег: неверный пароль или повреждённый файл — ошибка.
 */
export async function decryptFile(src, dest, password) {
  const size = fs.statSync(src).size;
  if (size < HEADER_LEN + TAG_LEN) throw new Error("Файл слишком короткий — это не зашифрованная копия");
  const fd = fs.openSync(src, "r");
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(TAG_LEN);
  try {
    fs.readSync(fd, header, 0, HEADER_LEN, 0);
    fs.readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN);
  } finally {
    fs.closeSync(fd);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Это не зашифрованная копия (нет заголовка PTSBK1)");
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_LEN);
  const iv = header.subarray(MAGIC.length + SALT_LEN, HEADER_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(password, salt), iv);
  decipher.setAuthTag(tag);
  const hash = crypto.createHash("sha256");
  const tap = new Transform({
    transform(chunk, _enc, done) {
      hash.update(chunk);
      done(null, dest ? chunk : undefined);
    },
  });
  const body = fs.createReadStream(src, { start: HEADER_LEN, end: size - TAG_LEN - 1 });
  try {
    if (dest) await pipeline(body, decipher, tap, fs.createWriteStream(dest));
    else await pipeline(body, decipher, tap, new Transform({ transform: (_c, _e, done) => done() }));
  } catch (error) {
    if (dest) fs.rmSync(dest, { force: true });
    throw new Error(/auth|unable to authenticate/i.test(String(error.message)) ? "Неверный пароль или файл повреждён" : error.message);
  }
  return hash.digest("hex");
}
