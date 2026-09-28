import { prisma } from "@/lib/db";
import { loadBackupFreshness } from "@/lib/backup/status";

/**
 * Проверка работоспособности для внешнего мониторинга (аптайм-чекер,
 * оркестратор контейнеров и т.п.). Не требует аутентификации — не отдаёт
 * никаких данных приложения, только факт доступности БД и свежесть
 * резервной копии (ok / stale / never) и её второй копии в другом месте
 * (ok / failed / off), чтобы монитор мог предупредить о пропущенном бэкапе. Устаревший бэкап не делает ответ ошибкой — само
 * приложение при этом работает.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
  const backup = await loadBackupFreshness().catch(() => null);
  return Response.json({
    status: "ok",
    database: "connected",
    backup: backup
      ? { state: backup.state, ageHours: backup.ageHours, mirror: backup.mirror }
      : { state: "unknown", ageHours: null, mirror: "unknown" },
    time: new Date().toISOString(),
  });
}
