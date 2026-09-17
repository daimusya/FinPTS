import { prisma } from "@/lib/db";
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

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isArchived: false },
    orderBy: { bankName: "asc" },
  });

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
    </div>
  );
}
