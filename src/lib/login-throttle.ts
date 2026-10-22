import { prisma } from "@/lib/db";

/** Не больше 5 неудачных попыток за 15 минут; после пятой — блокировка на 15 минут от неё. */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;
export const LOCK_MS = 15 * 60_000;

/**
 * Сколько минут ещё заблокирован вход по адресу (0 — не заблокирован): если за
 * последние 15 минут было 5 и больше неудач, блокировка длится 15 минут от
 * последней из них.
 */
export function lockedMinutes(failures: Date[], now: Date): number {
  return lockedMinutesFor(failures, now, MAX_FAILURES);
}

export async function loginLockedMinutes(email: string, now: Date = new Date()): Promise<number> {
  const failures = await prisma.loginFailure.findMany({
    where: { email, createdAt: { gte: new Date(now.getTime() - WINDOW_MS - LOCK_MS) } },
    select: { createdAt: true },
  });
  return lockedMinutes(failures.map((f) => f.createdAt), now);
}

export async function recordLoginFailure(email: string, now: Date = new Date()) {
  await prisma.loginFailure.create({ data: { email, createdAt: now } });
  // Old attempts are of no use: keep the table small.
  await prisma.loginFailure.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 24 * 3_600_000) } } });
}

/**
 * С одного адреса в интернете — не больше 20 неудачных попыток за 15 минут по
 * любым почтам: иначе подбирают популярные пароли ко многим учётным записям
 * сразу, не упираясь в блокировку одной. Хранится в той же таблице с ключом
 * «ip:адрес».
 */
export const MAX_IP_FAILURES = 20;

export function lockedMinutesFor(failures: Date[], now: Date, max: number): number {
  const recent = failures.filter((d) => now.getTime() - d.getTime() < WINDOW_MS).sort((a, b) => a.getTime() - b.getTime());
  if (recent.length < max) return 0;
  const until = recent[recent.length - 1].getTime() + LOCK_MS;
  return until > now.getTime() ? Math.ceil((until - now.getTime()) / 60_000) : 0;
}

export const ipKey = (ip: string) => `ip:${ip}`;

export async function ipLockedMinutes(ip: string | null, now: Date = new Date()): Promise<number> {
  if (!ip) return 0;
  const failures = await prisma.loginFailure.findMany({
    where: { email: ipKey(ip), createdAt: { gte: new Date(now.getTime() - WINDOW_MS - LOCK_MS) } },
    select: { createdAt: true },
  });
  return lockedMinutesFor(failures.map((f) => f.createdAt), now, MAX_IP_FAILURES);
}

/** Адрес клиента: за прокси (Caddy, nginx) — первый в X-Forwarded-For, который прокси заполняет сам. */
export function clientIp(forwardedFor: string | null, realIp: string | null): string | null {
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || realIp?.trim() || null;
}

export async function clearLoginFailures(email: string) {
  await prisma.loginFailure.deleteMany({ where: { email } });
}
