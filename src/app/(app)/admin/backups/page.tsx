import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { BACKUP_MAX_AGE_HOURS, loadBackupFreshness } from "@/lib/backup/status";

function formatSize(bytes: bigint | null): string {
  if (bytes === null) return "—";
  const n = Number(bytes);
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`;
}

const STATUS: Record<string, { label: string; badge: string }> = {
  success: { label: "Успешно", badge: "badge-active" },
  failed: { label: "Ошибка", badge: "badge-danger" },
  running: { label: "Выполняется", badge: "badge-orange" },
};

export default async function BackupsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.ADMIN_FULL)) {
    return (
      <div className="page">
        <div className="card">Раздел доступен только полному администратору.</div>
      </div>
    );
  }

  const [freshness, runs] = await Promise.all([
    loadBackupFreshness(),
    prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 30 }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Резервные копии</h1>
          <p>
            Журнал запусков резервного копирования базы данных (скрипт <code>npm run db:backup</code> по расписанию).
            Копии хранятся на сервере в папке <code>backups/</code> (или <code>BACKUP_DIR</code>).
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        {freshness.state === "ok" ? (
          <p className="form-success">
            Последняя успешная копия — {freshness.lastSuccessAt!.toLocaleString("ru-RU")} ({freshness.ageHours} ч назад).
          </p>
        ) : freshness.state === "stale" ? (
          <p className="form-error">
            Последняя успешная копия сделана {freshness.ageHours} ч назад ({freshness.lastSuccessAt!.toLocaleString("ru-RU")}) —
            дольше {BACKUP_MAX_AGE_HOURS} ч. Проверьте, работает ли расписание, и журнал ошибок ниже.
          </p>
        ) : (
          <p className="form-error">Ни одной успешной резервной копии ещё не сделано. Настройте расписание (см. ниже).</p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Последние запуски</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Начало</th>
                <th>Статус</th>
                <th>Файл</th>
                <th>Размер</th>
                <th>Таблиц</th>
                <th>Проверка восстановления</th>
                <th>Удалено старых</th>
                <th>Сервер</th>
                <th>Ошибка / подробности</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const status = STATUS[run.status] ?? { label: run.status, badge: "badge-archived" };
                return (
                  <tr key={run.id}>
                    <td>{run.startedAt.toLocaleString("ru-RU")}</td>
                    <td>
                      <span className={`badge ${status.badge}`}>{status.label}</span>
                    </td>
                    <td className="mono">{run.fileName ?? "—"}</td>
                    <td>{formatSize(run.sizeBytes)}</td>
                    <td>{run.tableCount ?? "—"}</td>
                    <td>
                      {run.restoreCheck === "ok" ? (
                        <span className="text-good">пройдена</span>
                      ) : run.restoreCheck === "mismatch" ? (
                        <span className="text-bad">расхождения</span>
                      ) : (
                        <span className="text-muted">не проводилась</span>
                      )}
                    </td>
                    <td>{run.deletedOld ?? "—"}</td>
                    <td>{run.host ?? "—"}</td>
                    <td style={{ maxWidth: 420, whiteSpace: "normal" }}>
                      {run.error ? <span className="text-bad">{run.error}</span> : (run.restoreDetails ?? "")}
                    </td>
                  </tr>
                );
              })}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Запусков ещё не было.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Как устроено</h2>
        <ul style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>
            <code>npm run db:backup</code> — копия в формате pg_dump (custom, сжатая), проверка, что архив читается, и
            удаление старых копий сверх <code>BACKUP_KEEP</code> (по умолчанию 14). <code>npm run db:backup:verify</code> —
            то же плюс пробное восстановление во временную базу и сверка числа строк по всем таблицам.
          </li>
          <li>
            Расписание на Windows:{" "}
            <code>powershell -ExecutionPolicy Bypass -File scripts\register-backup-task.ps1</code> создаёт ежедневную задачу
            в Планировщике заданий (по умолчанию в 03:00, каждый раз с пробным восстановлением; если компьютер был
            выключен — при следующем включении). На Linux — строка в crontab:{" "}
            <code>0 3 * * * cd /путь/к/проекту &amp;&amp; npm run db:backup:verify</code>. В Docker — сервис{" "}
            <code>backup</code> в <code>docker-compose.yml</code>.
          </li>
          <li>
            Копии лежат на том же сервере, что и база, — это защищает от ошибок в данных, но не от потери диска.
            Регулярно переносите папку с копиями в другое место (облачный диск, другой сервер).
          </li>
          <li>
            Восстановление (затирает текущие данные — остановите приложение):{" "}
            <code>pg_restore --clean --if-exists --no-owner --dbname promtehnosfera backups/&lt;файл&gt;.dump</code>. Безопаснее
            восстановить в новую базу, проверить и переключить на неё <code>DATABASE_URL</code>.
          </li>
        </ul>
      </div>
    </div>
  );
}
