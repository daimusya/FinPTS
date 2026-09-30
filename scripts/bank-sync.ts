/**
 * Загрузка выписки по API банков для всех включённых подключений
 * (Интеграции → «Банки: выписка по API»). Запускается Планировщиком Windows
 * (scripts/register-bank-sync-task.ps1) или вручную: npm run bank:sync.
 * Заодно загружает сегодняшние курсы ЦБ для валютных счетов и запускает
 * проверки мониторинга с оповещениями администраторам (src/lib/monitoring).
 * Код выхода 2 — хотя бы по одному счёту ошибка (Планировщик покажет её).
 */
import fs from "node:fs";

// AUTH_SECRET (the key of the stored bank credentials) and DATABASE_URL come from .env, as for the app.
if (fs.existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const { syncAllConnections } = await import("@/lib/bank-api/sync");
  const { prisma } = await import("@/lib/db");
  const { ensureRecentRates } = await import("@/lib/currency-rates");
  const { runMonitoring } = await import("@/lib/monitoring/alerts");
  try {
    const outcomes = await syncAllConnections();
    const stamp = new Date().toISOString();
    if (outcomes.length === 0) console.log(`${stamp} Подключённых счетов нет`);
    for (const o of outcomes) console.log(`${stamp} [${o.status}] ${o.connectionId}: ${o.message}`);
    process.exitCode = outcomes.some((o) => o.status === "error") ? 2 : 0;
    // Today's official rates for foreign-currency accounts (reports revalue balances with them).
    try {
      const rates = await ensureRecentRates();
      if (rates) console.log(`${stamp} [ok] ${rates}`);
    } catch (error) {
      console.error(`${stamp} [error] курсы ЦБ: ${(error as Error).message}`);
    }
    // Monitoring checks and alerts to administrators (in-app notifications), on the same schedule.
    try {
      const monitoring = await runMonitoring();
      const bad = monitoring.checks.filter((c) => c.status !== "ok");
      console.log(`${stamp} [${bad.length ? "warn" : "ok"}] мониторинг: ${bad.length ? bad.map((c) => `${c.title} — ${c.message}`).join("; ") : "всё в порядке"}${monitoring.notices.length ? `; оповещений ${monitoring.notices.length}` : ""}`);
    } catch (error) {
      console.error(`${stamp} [error] мониторинг: ${(error as Error).message}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`${new Date().toISOString()} Ошибка загрузки выписок: ${(error as Error).message}`);
  process.exitCode = 1;
});
