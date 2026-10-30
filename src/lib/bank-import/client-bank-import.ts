import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission, type SessionPayload } from "@/lib/session";
import { accountAllowed, organizationAllowed } from "@/lib/access-guard";
import { getAccessScope } from "@/lib/access-scope";
import { isClientBankExchange, parseClientBankStatement, type ClientBankStatement } from "./client-bank";
import { importStatementOperations } from "./import-operations";

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface ClientBankFileResult {
  fileName: string;
  accountNumber?: string;
  period?: string;
  imported?: number;
  duplicates?: number;
  inflows?: number;
  closedPeriodRows?: number;
  closedMonths?: string[];
  /** Счёт заведён в справочнике этой загрузкой. */
  accountCreated?: boolean;
  error?: string;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10).split("-").reverse().join(".") : "…");

/** «ФИЛИАЛ "САНКТ-ПЕТЕРБУРГСКИЙ" АО "АЛЬФА-БАНК" г Санкт-Петербург» → «АО "АЛЬФА-БАНК"». */
function shortBankName(statement: ClientBankStatement): string {
  const full = statement.bankName ?? "";
  const legal = [...full.matchAll(/(?:ПАО|АО|ООО|НКО|КБ)\s+"[^"]+"/g)].pop()?.[0];
  return legal ?? (full || statement.sender || "Банк");
}

/**
 * Загрузка выписок 1С «Клиент-банк» в один шаг: счёт определяется по номеру
 * из файла. Если такого счёта в справочнике нет, он заводится в выбранной
 * организации — только у пользователя с правом вести справочники.
 */
export async function importClientBankFiles(
  session: SessionPayload,
  files: File[],
  organizationIdForNewAccounts: string | null,
): Promise<ClientBankFileResult[]> {
  const results: ClientBankFileResult[] = [];
  for (const file of files) {
    const result: ClientBankFileResult = { fileName: file.name };
    results.push(result);
    if (file.size > MAX_FILE_BYTES) {
      result.error = "Файл слишком большой (максимум 8 МБ)";
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isClientBankExchange(buffer)) {
      result.error = "Это не выписка в формате 1С (1CClientBankExchange) — загрузите её через «Банк и касса → Загрузка выписки»";
      continue;
    }
    const statement = parseClientBankStatement(buffer);
    result.period = `${day(statement.periodFrom)} – ${day(statement.periodTo)}`;
    if (!statement.accountNumber) {
      result.error = "В файле не указан расчётный счёт (РасчСчет)";
      continue;
    }
    result.accountNumber = statement.accountNumber;

    let account = await prisma.bankAccount.findFirst({
      where: { accountNumber: statement.accountNumber, isArchived: false },
      select: { id: true },
    });
    if (!account) {
      if (!hasPermission(session, PERMISSIONS.MASTERDATA_MANAGE)) {
        result.error = `Счёта ${statement.accountNumber} нет в справочнике «Банковские счета» — попросите добавить его`;
        continue;
      }
      if (!organizationIdForNewAccounts || !(await organizationAllowed(session, organizationIdForNewAccounts))) {
        result.error = `Счёта ${statement.accountNumber} нет в справочнике — выберите организацию, к которой его добавить`;
        continue;
      }
      account = await prisma.bankAccount.create({
        data: {
          organizationId: organizationIdForNewAccounts,
          bankName: shortBankName(statement),
          accountNumber: statement.accountNumber,
          bik: statement.bik,
        },
        select: { id: true },
      });
      result.accountCreated = true;
      await logAudit({
        userId: session.userId,
        entityType: "bank_account",
        entityId: account.id,
        action: "create",
        after: { accountNumber: statement.accountNumber, source: file.name },
      });
    } else if (!(await accountAllowed(session, account.id, null))) {
      result.error = `Счёт ${statement.accountNumber} принадлежит организации, к которой у вас нет доступа`;
      continue;
    }

    const imported = await importStatementOperations({
      bankAccountId: account.id,
      operations: statement.operations,
      fileName: file.name,
      format: "1c",
      importedById: session.userId,
      totalRows: statement.totalRows,
      errorRows: statement.errorRows,
    });
    await logAudit({
      userId: session.userId,
      entityType: "bank_import_batch",
      entityId: imported.batchId,
      action: "import",
      after: { fileName: file.name, imported: imported.imported, duplicates: imported.duplicates, closedPeriodRows: imported.closedPeriodRows },
    });
    result.imported = imported.imported;
    result.duplicates = imported.duplicates;
    result.closedPeriodRows = imported.closedPeriodRows;
    result.closedMonths = imported.closedMonths;
    result.inflows = statement.operations.filter((op) => op.direction === "INFLOW").length;
  }
  return results;
}

/** Организации, в которые загрузка может завести новый счёт: пусто, если пользователь не ведёт справочники. */
export async function organizationsForNewAccounts(session: SessionPayload): Promise<Array<{ value: string; label: string }>> {
  if (!hasPermission(session, PERMISSIONS.MASTERDATA_MANAGE)) return [];
  const scope = await getAccessScope(session);
  const rows = await prisma.organization.findMany({
    where: { isArchived: false, ...(scope.organizationIds ? { id: { in: scope.organizationIds } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return rows.map((r) => ({ value: r.id, label: r.name }));
}
