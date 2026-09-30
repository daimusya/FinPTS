import { timingSafeEqual } from "node:crypto";
import { runChecks, loadMetrics } from "@/lib/monitoring/load";
import { formatPrometheus } from "@/lib/monitoring/prometheus";

/**
 * Метрики в формате Prometheus для внешней системы мониторинга. Выключено,
 * пока в .env не задан METRICS_TOKEN (тогда 404); запрос — с заголовком
 * Authorization: Bearer <токен>. Отдаёт только состояние проверок и
 * счётчики, без данных о деньгах и людях.
 */
export async function GET(request: Request) {
  const token = process.env.METRICS_TOKEN;
  if (!token) return new Response("Not found", { status: 404 });
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });

  const now = new Date();
  const [checks, metrics] = await Promise.all([runChecks(now), loadMetrics(now)]);
  return new Response(formatPrometheus(checks, metrics), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" } });
}
