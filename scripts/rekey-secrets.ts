/**
 * Перешифровка секретов при переезде на новый AUTH_SECRET (сервер): ключи
 * интеграций (DaData, Битрикс24, почта, Telegram), ключи банков и секреты
 * входа с кодом зашифрованы прежним AUTH_SECRET — без этого шага новый сервер
 * их не прочтёт, а вход с кодом сломается.
 *
 *   OLD_AUTH_SECRET="прежний секрет" npm run rekey-secrets
 *
 * Всё или ничего: если хоть одно значение не расшифровалось прежним секретом
 * (секрет не тот), ничего не меняется.
 */
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const from = process.env.OLD_AUTH_SECRET ?? "";
  const to = process.env.AUTH_SECRET ?? "";
  if (!from || !to) {
    console.error("Нужны OLD_AUTH_SECRET (прежний секрет) и AUTH_SECRET (новый).");
    process.exitCode = 1;
    return;
  }
  if (from === to) {
    console.log("Секрет не менялся — перешифровывать нечего.");
    return;
  }
  const { prisma } = await import("@/lib/db");
  const { rekeyConfig } = await import("@/lib/crypto/rekey");
  const { reencryptSecret } = await import("@/lib/crypto/secret-box");
  try {
    const counts = await prisma.$transaction(
      async (db) => {
        let profiles = 0;
        for (const p of await db.integrationProfile.findMany()) {
          const { value, count } = rekeyConfig(p.config, from, to);
          if (count > 0) {
            await db.integrationProfile.update({ where: { id: p.id }, data: { config: value as never } });
            profiles += count;
          }
        }
        let banks = 0;
        for (const c of await db.bankConnection.findMany({ select: { id: true, credentialsEncrypted: true } })) {
          await db.bankConnection.update({ where: { id: c.id }, data: { credentialsEncrypted: reencryptSecret(c.credentialsEncrypted, from, to) } });
          banks++;
        }
        let users = 0;
        for (const u of await db.user.findMany({
          where: { OR: [{ totpSecretEnc: { not: null } }, { totpPendingSecretEnc: { not: null } }] },
          select: { id: true, totpSecretEnc: true, totpPendingSecretEnc: true },
        })) {
          await db.user.update({
            where: { id: u.id },
            data: {
              totpSecretEnc: u.totpSecretEnc ? reencryptSecret(u.totpSecretEnc, from, to) : null,
              totpPendingSecretEnc: u.totpPendingSecretEnc ? reencryptSecret(u.totpPendingSecretEnc, from, to) : null,
            },
          });
          users++;
        }
        return { profiles, banks, users };
      },
      { timeout: 120_000 },
    );
    console.log(`Перешифровано: ключей интеграций ${counts.profiles}, подключений банков ${counts.banks}, пользователей со входом по коду ${counts.users}.`);
  } catch (error) {
    console.error(`Ничего не изменено: ${error instanceof Error ? error.message : error}. Проверьте, что OLD_AUTH_SECRET — секрет из .env прежнего компьютера.`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
