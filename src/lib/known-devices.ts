import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { requestIsHttps } from "@/lib/request-security";
import { clientIp } from "@/lib/login-throttle";

/**
 * Вход с незнакомого браузера — уведомление владельцу учётной записи: если
 * пароль (и код) узнал посторонний, человек увидит это сразу. Браузер
 * получает постоянную случайную метку (кука); в базе — только её отпечаток.
 * Самый первый запомненный браузер уведомления не вызывает.
 */
const DEVICE_COOKIE = "pts_device";
/** Браузеры ограничивают срок кук примерно 400 днями. */
const DEVICE_COOKIE_DAYS = 400;

const hashOf = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** «Chrome, Windows» по строке браузера — для уведомления и списка устройств. Чистая функция. */
export function describeUserAgent(ua: string | null): string {
  const s = ua ?? "";
  const browser = /YaBrowser/i.test(s)
    ? "Яндекс Браузер"
    : /Edg\//i.test(s)
      ? "Edge"
      : /OPR\/|Opera/i.test(s)
        ? "Opera"
        : /Firefox\//i.test(s)
          ? "Firefox"
          : /Chrome\//i.test(s)
            ? "Chrome"
            : /Safari\//i.test(s)
              ? "Safari"
              : "браузер";
  const os = /Android/i.test(s)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(s)
      ? "iOS"
      : /Windows/i.test(s)
        ? "Windows"
        : /Mac OS X|Macintosh/i.test(s)
          ? "macOS"
          : /Linux/i.test(s)
            ? "Linux"
            : null;
  return os ? `${browser}, ${os}` : browser;
}

const validToken = (value: string | undefined) => (value && /^[a-f0-9]{64}$/.test(value) ? value : null);

/** Отпечаток метки этого браузера (null — метки нет): отметить «это устройство» в списке. */
export async function currentDeviceHash(): Promise<string | null> {
  const token = validToken((await cookies()).get(DEVICE_COOKIE)?.value);
  return token ? hashOf(token) : null;
}

/** Метка этого браузера (выдаётся, если её ещё нет), название и адрес. */
async function thisDevice() {
  const store = await cookies();
  const head = await headers();
  let token = validToken(store.get(DEVICE_COOKIE)?.value);
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    store.set(DEVICE_COOKIE, token, {
      httpOnly: true,
      secure: await requestIsHttps(),
      sameSite: "lax",
      path: "/",
      maxAge: DEVICE_COOKIE_DAYS * 24 * 3600,
    });
  }
  return {
    deviceHash: hashOf(token),
    label: describeUserAgent(head.get("user-agent")),
    ip: clientIp(head.get("x-forwarded-for"), head.get("x-real-ip")),
  };
}

/** Запомнить браузер после успешного входа; с незнакомого — уведомить владельца. */
export async function rememberSignInDevice(userId: string, now: Date = new Date()): Promise<{ newDevice: boolean }> {
  const { deviceHash, label, ip } = await thisDevice();

  const known = await prisma.knownDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash } } });
  if (known) {
    await prisma.knownDevice.update({ where: { id: known.id }, data: { lastSeenAt: now, lastIp: ip, label } });
    return { newDevice: false };
  }
  const before = await prisma.knownDevice.count({ where: { userId } });
  await prisma.knownDevice.create({ data: { userId, deviceHash, label, lastIp: ip, firstSeenAt: now, lastSeenAt: now } });
  if (before > 0) {
    const when = now.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });
    await notify([userId], {
      title: "Вход с нового устройства",
      body: `В вашу учётную запись вошли: ${label}${ip ? `, адрес ${ip}` : ""}, ${when} (МСК). Если это были не вы — сразу смените пароль и завершите сеансы на других устройствах.`,
      link: "/account/password",
    });
  }
  return { newDevice: before > 0 };
}

/**
 * После «завершить сеансы» или смены пароля прочие браузеры перестают быть
 * знакомыми: если посторонний снова войдёт с них, владелец получит
 * уведомление. Этот браузер (человек знает пароль) остаётся запомненным.
 */
export async function forgetOtherDevices(userId: string, now: Date = new Date()): Promise<number> {
  const { deviceHash, label, ip } = await thisDevice();
  await prisma.knownDevice.upsert({
    where: { userId_deviceHash: { userId, deviceHash } },
    update: { lastSeenAt: now, lastIp: ip, label },
    create: { userId, deviceHash, label, lastIp: ip, firstSeenAt: now, lastSeenAt: now },
  });
  const { count } = await prisma.knownDevice.deleteMany({ where: { userId, deviceHash: { not: deviceHash } } });
  return count;
}
