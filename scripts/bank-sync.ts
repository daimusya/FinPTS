/**
 * Загрузка выписки по API банков для всех включённых подключений
 * (Интеграции → «Банки: выписка по API»). Запускается Планировщиком Windows
 * (scripts/register-bank-sync-task.ps1) или вручную: npm run bank:sync.
 * Код выхода 2 — хотя бы по одному счёту ошибка (Планировщик покажет её).
 */
import fs from "node:fs";

// AUTH_SECRET (the key of the stored bank credentials) and DATABASE_URL come from .env, as for the app.
if (fs.existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const { syncAllConnections } = await import("@/lib/bank-api/sync");
  const { prisma } = await import("@/lib/db");
  try {
    const outcomes = await syncAllConnections();
    const stamp = new Date().toISOString();
    if (outcomes.length === 0) console.log(`${stamp} Подключённых счетов нет`);
    for (const o of outcomes) console.log(`${stamp} [${o.status}] ${o.connectionId}: ${o.message}`);
    process.exitCode = outcomes.some((o) => o.status === "error") ? 2 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`${new Date().toISOString()} Ошибка загрузки выписок: ${(error as Error).message}`);
  process.exitCode = 1;
});
