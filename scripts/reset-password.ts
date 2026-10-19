/**
 * Аварийный сброс пароля, когда войти некому: единственный администратор
 * забыл пароль, а сбросить его через «Пользователи» больше никто не может.
 * Запускается на сервере, где лежит .env с доступом к базе:
 *
 *   npm run reset-password -- адрес@почты
 *
 * Печатает временный пароль только в этот терминал; при первом входе система
 * попросит заменить его своим. Блокировка входа после неудачных попыток
 * снимается, все прежние сеансы пользователя завершаются, в журнале остаётся
 * запись reset_password (без пароля).
 */
import crypto from "node:crypto";
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) {
    console.error("Укажите адрес входа: npm run reset-password -- адрес@почты");
    process.exitCode = 1;
    return;
  }
  const { prisma } = await import("@/lib/db");
  const { hashPassword } = await import("@/lib/auth");
  const { logAudit } = await import("@/lib/audit");
  const { clearLoginFailures } = await import("@/lib/login-throttle");
  try {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
    if (!user) {
      console.error(`Пользователь ${email} не найден.`);
      process.exitCode = 1;
      return;
    }
    if (!user.isActive) {
      console.error(`Пользователь ${user.email} отключён — сначала включите его (или сбросьте пароль другому администратору).`);
      process.exitCode = 1;
      return;
    }
    const tempPassword = crypto.randomBytes(9).toString("base64url");
    // A reset ends the user's current sessions and asks for an own password at the next sign-in.
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(tempPassword), mustChangePassword: true, passwordChangedAt: new Date() },
    });
    // Guessing has usually locked the sign-in: the temporary password must work right away.
    await clearLoginFailures(user.email.trim().toLowerCase());
    await logAudit({ userId: null, entityType: "user", entityId: user.id, action: "reset_password", after: { via: "console" } as never });
    console.log(`Пароль пользователя ${user.email} сброшен.`);
    console.log(`Временный пароль: ${tempPassword}`);
    console.log("Войдите с ним — система сразу попросит задать свой пароль. Закройте это окно после входа.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
