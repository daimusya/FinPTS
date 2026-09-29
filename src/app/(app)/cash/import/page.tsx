import Link from "next/link";
import { prisma } from "@/lib/db";
import { getAccessScope } from "@/lib/access-scope";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { ImportWizard } from "./import-wizard";

export default async function CashImportPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для загрузки выписок.</div>
      </div>
    );
  }

  const scope = await getAccessScope(session);
  const [bankAccounts, batches] = await Promise.all([
    prisma.bankAccount.findMany({
      where: { isArchived: false },
      orderBy: { bankName: "asc" },
    }),
    prisma.bankImportBatch.findMany({
      where: scope.organizationIds ? { bankAccount: { organizationId: { in: scope.organizationIds } } } : {},
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { bankAccount: true, importedBy: { select: { fullName: true, email: true } } },
    }),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Загрузка банковской выписки</h1>
          <p>
            Поддерживаются файлы XLSX, XLS, CSV, TXT произвольного формата — колонки сопоставляются вручную.
            Повторно загруженные строки автоматически пропускаются.
          </p>
        </div>
      </div>

      {bankAccounts.length === 0 ? (
        <div className="card">
          Сначала добавьте хотя бы один банковский счёт в разделе «Справочники → Банковские счета».
        </div>
      ) : (
        <ImportWizard bankAccounts={bankAccounts.map((a) => ({ value: a.id, label: `${a.bankName} · ${a.accountNumber}` }))} />
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>История загрузок</h2>
        <p className="text-muted" style={{ marginBottom: 10 }}>
          Последние 50 загрузок — из файлов и по API банков. «Загружено» — сколько операций загрузки сейчас в «Банк и касса»:
          удалённые потом операции вычитаются и показаны отдельно. Ошибочную загрузку можно открыть, отметить все её
          операции и удалить.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Когда</th>
                <th>Счёт</th>
                <th>Файл / источник</th>
                <th>Строк</th>
                <th>Загружено</th>
                <th>Дублей</th>
                <th>Ошибок</th>
                <th>Удалено потом</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>
                    {b.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" })}
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {b.importedBy ? b.importedBy.fullName || b.importedBy.email : "автоматически"}
                    </div>
                  </td>
                  <td>
                    {b.bankAccount.bankName} {b.bankAccount.accountNumber}
                  </td>
                  <td>{b.fileName}</td>
                  <td className="mono">{b.totalRows}</td>
                  <td className="mono">{b.importedRows}</td>
                  <td className="mono">{b.duplicateRows}</td>
                  <td className="mono">{b.errorRows}</td>
                  <td className="mono">{b.deletedRows || "—"}</td>
                  <td>
                    {b.importedRows > 0 ? (
                      <Link href={`/cash/transactions?batchId=${b.id}`} className="btn btn-ghost btn-sm">
                        Операции
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {batches.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Загрузок пока не было.
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
