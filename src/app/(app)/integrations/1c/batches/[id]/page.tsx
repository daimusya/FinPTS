import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";

interface ErrorLogEntry {
  row: number;
  message: string;
}

export default async function OnecBatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.INTEGRATIONS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const batch = await prisma.integrationBatch.findUnique({ where: { id } });
  if (!batch) notFound();

  const errorLog = (batch.errorLog as ErrorLogEntry[] | null) ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Импорт: {batch.fileName ?? batch.id}</h1>
          <p>
            {batch.startedAt.toLocaleString("ru-RU")} · создано {batch.importedCount}, обновлено{" "}
            {batch.updatedCount}, ошибок {batch.errorCount}
          </p>
        </div>
        <Link href="/integrations/1c" className="btn btn-secondary">
          Назад
        </Link>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Очередь ошибок</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Исправьте данные в исходном файле и загрузите его заново — уже импортированные строки будут
          обновлены по внешнему ID, а не задублированы.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Строка файла</th>
                <th>Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {errorLog.map((entry, idx) => (
                <tr key={idx}>
                  <td className="mono">{entry.row}</td>
                  <td>{entry.message}</td>
                </tr>
              ))}
              {errorLog.length === 0 ? (
                <tr>
                  <td colSpan={2} className="empty-state">
                    Ошибок нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
