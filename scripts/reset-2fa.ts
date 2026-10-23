/**
 * Аварийный сброс входа с кодом, когда сбросить его некому: единственный
 * администратор потерял телефон и резервные коды. Запускается на сервере, где
 * лежит .env с доступом к базе:
 *
 *   npm run reset-2fa -- адрес@почты
 *
 * Код и резервные коды стираются, все сеансы пользователя завершаются; войти
 * можно по паролю, а если вход с кодом обязателен — система сразу попросит
 * подключить его заново. В журнале остаётся запись mfa_reset.
 */
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) {
    console.error("Укажите адрес входа: npm run reset-2fa -- адрес@почты");
    process.exitCode = 1;
    return;
  }
  const { prisma } = await import("@/lib/db");
  const { logAudit } = await import("@/lib/audit");
  try {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (!user) {
      console.error(`Пользователь ${email} не найден.`);
      process.exitCode = 1;
      return;
    }
    if (!user.totpEnabledAt && !user.totpPendingSecretEnc) {
      console.log(`У пользователя ${user.email} вход с кодом и так не подключён.`);
      return;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastStep: null, totpRecoveryHashes: [], sessionsRevokedAt: new Date() },
    });
    await logAudit({ userId: null, entityType: "user", entityId: user.id, action: "mfa_reset", after: { via: "console" } as never });
    console.log(`Вход с кодом у ${user.email} сброшен, сеансы завершены. Войдите по паролю и подключите код заново на новом телефоне.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
