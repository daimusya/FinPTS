/**
 * Проверки мониторинга и оповещения администраторам (колокольчик в
 * системе): npm run monitor. Планировщик запускает их вместе с выписками по
 * API (scripts/bank-sync.ts). Код выхода 2 — есть сбой (fail).
 */
import fs from "node:fs";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

async function main() {
  const { runMonitoring } = await import("@/lib/monitoring/alerts");
  const { prisma } = await import("@/lib/db");
  try {
    const stamp = new Date().toISOString();
    const result = await runMonitoring();
    for (const c of result.checks) console.log(`${stamp} [${c.status}] ${c.title}: ${c.message}`);
    if (result.notices.length > 0) console.log(`${stamp} оповещений: ${result.notices.length}, получателей: ${result.recipients}`);
    process.exitCode = result.checks.some((c) => c.status === "fail") ? 2 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`${new Date().toISOString()} Ошибка мониторинга: ${(error as Error).message}`);
  process.exitCode = 1;
});
