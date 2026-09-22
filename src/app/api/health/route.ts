import { prisma } from "@/lib/db";

/**
 * Проверка работоспособности для внешнего мониторинга (аптайм-чекер,
 * оркестратор контейнеров и т.п.). Не требует аутентификации — не отдаёт
 * никаких данных приложения, только факт доступности БД.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", database: "connected", time: new Date().toISOString() });
  } catch {
    return Response.json({ status: "error", database: "unreachable" }, { status: 503 });
  }
}
