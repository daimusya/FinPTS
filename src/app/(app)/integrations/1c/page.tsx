import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { OnecImportWizard } from "./import-wizard";

const STATUS_LABELS: Record<string, string> = {
  running: "Выполняется",
  completed: "Завершён",
  failed: "Ошибка",
};

export default async function OnecIntegrationPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.INTEGRATIONS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления интеграциями.</div>
      </div>
    );
  }

  const batches = await prisma.integrationBatch.findMany({
    where: { profile: { system: "1C" } },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>1С:Бухгалтерия — файловый обмен</h1>
          <p>
            Импорт документов начисления из выгрузки 1С (XLSX/CSV/TXT). Импорт идемпотентен: повторная
            загрузка того же файла обновит уже импортированные документы по внешнему ID, а не создаст дубли.
            Прямой обмен через HTTP/OData отключён — нет адреса публикации и учётных данных (раздел
            «Не реализовано» README).
          </p>
        </div>
        <a href="/api/integrations/1c/template" className="btn btn-secondary">
          Скачать шаблон файла
        </a>
      </div>

      <OnecImportWizard />

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Журнал синхронизации</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Файл</th>
                <th>Статус</th>
                <th>Создано</th>
                <th>Обновлено</th>
                <th>Ошибок</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.startedAt.toLocaleString("ru-RU")}</td>
                  <td>{b.fileName ?? "—"}</td>
                  <td>
                    <span className={`badge ${b.status === "completed" ? "badge-active" : "badge-warning"}`}>
                      {STATUS_LABELS[b.status] ?? b.status}
                    </span>
                  </td>
                  <td>{b.importedCount}</td>
                  <td>{b.updatedCount}</td>
                  <td>
                    {b.errorCount > 0 ? (
                      <Link href={`/integrations/1c/batches/${b.id}`} className="badge badge-danger">
                        {b.errorCount}
                      </Link>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td>
                    {b.errorCount > 0 ? (
                      <Link href={`/integrations/1c/batches/${b.id}`} className="btn btn-ghost btn-sm">
                        Подробнее
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Импортов пока не было.
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
