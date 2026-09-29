import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { importStatementOperations } from "@/lib/bank-import/import-operations";
import {
  BANK_PROVIDER_LABELS,
  BankApiError,
  decryptCredentials,
  defaultHttpClient,
  encryptCredentials,
  isBankProvider,
  type HttpClient,
} from "./core";
import { fetchStatement } from "./providers";

/** Банки проводят операции и задним числом — каждая загрузка перекрывает прошлую на 3 дня (дубли отсекаются). */
export const OVERLAP_DAYS = 3;
/** Запуск считается зависшим, если идёт дольше 15 минут. */
const RUNNING_TIMEOUT_MS = 15 * 60_000;

/** Сегодня по Москве (ГГГГ-ММ-ДД) — банки ведут выписку по московскому дню. */
export function moscowToday(now: Date): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
}

/** С какого дня загружать: с даты начала, а после успешной загрузки — с её дня минус 3 дня (не раньше даты начала). */
export function syncWindow(syncFrom: Date, lastSuccessAt: Date | null, now: Date): { from: string; to: string } {
  const start = syncFrom.toISOString().slice(0, 10);
  const to = moscowToday(now);
  if (!lastSuccessAt) return { from: start, to };
  const overlap = new Date(Date.parse(`${moscowToday(lastSuccessAt)}T00:00:00Z`) - OVERLAP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const from = overlap > start ? overlap : start;
  return { from: from > to ? to : from, to };
}

export interface SyncOutcome {
  connectionId: string;
  status: "ok" | "error" | "skipped";
  message: string;
  imported: number;
}

/**
 * Загружает выписку одного подключения: операции банка за окно загрузки →
 * «Банк и касса» (importStatementOperations: дубли, контрагенты по ИНН,
 * правила). Результат — в подключении (статус, сообщение, число новых).
 * Параллельный второй запуск того же подключения пропускается.
 */
export async function syncConnection(connectionId: string, options: { http?: HttpClient; now?: Date; userId?: string | null } = {}): Promise<SyncOutcome> {
  const now = options.now ?? new Date();
  const connection = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connectionId }, include: { bankAccount: true } });
  if (connection.lastStatus === "running" && connection.lastSyncAt && now.getTime() - connection.lastSyncAt.getTime() < RUNNING_TIMEOUT_MS) {
    return { connectionId, status: "skipped", message: "Загрузка по этому счёту уже идёт", imported: 0 };
  }
  await prisma.bankConnection.update({ where: { id: connectionId }, data: { lastStatus: "running", lastSyncAt: now } });

  const provider = connection.provider;
  const window = syncWindow(connection.syncFrom, connection.lastSuccessAt, now);
  try {
    if (!isBankProvider(provider)) throw new BankApiError(`Неизвестный банк «${provider}»`);
    const credentials = decryptCredentials(connection.credentialsEncrypted);
    const result = await fetchStatement(
      provider,
      credentials,
      { accountNumber: connection.bankAccount.accountNumber, bik: connection.bankAccount.bik },
      window.from,
      window.to,
      { http: options.http ?? defaultHttpClient, now },
    );
    // New OAuth tokens are saved at once, even if the import below fails.
    if (result.credentials) {
      await prisma.bankConnection.update({ where: { id: connectionId }, data: { credentialsEncrypted: encryptCredentials(result.credentials) } });
    }
    let imported = 0;
    let duplicates = 0;
    if (result.operations.length > 0) {
      const saved = await importStatementOperations({
        bankAccountId: connection.bankAccountId,
        operations: result.operations,
        fileName: `API ${BANK_PROVIDER_LABELS[provider]}: ${window.from}…${window.to}`,
        format: `api-${provider}`,
        importedById: options.userId ?? null,
        errorRows: result.skipped,
      });
      imported = saved.imported;
      duplicates = saved.duplicates;
      if (saved.imported > 0) {
        await logAudit({
          userId: options.userId ?? null,
          entityType: "bank_import_batch",
          entityId: saved.batchId,
          action: "import_api",
          after: { provider, from: window.from, to: window.to, imported: saved.imported, duplicates: saved.duplicates, autoClassified: saved.autoClassified } as never,
        });
      }
    }
    const message = `${window.from}…${window.to}: операций в выписке ${result.operations.length}, новых ${imported}, уже были ${duplicates}${
      result.skipped ? `, пропущено неполных ${result.skipped}` : ""
    }`;
    await prisma.bankConnection.update({
      where: { id: connectionId },
      data: { lastStatus: "ok", lastSuccessAt: now, lastMessage: message, lastImported: imported },
    });
    return { connectionId, status: "ok", message, imported };
  } catch (error) {
    const message = error instanceof BankApiError ? error.message : `Ошибка загрузки: ${(error as Error).message}`;
    await prisma.bankConnection.update({ where: { id: connectionId }, data: { lastStatus: "error", lastMessage: message, lastImported: 0 } });
    return { connectionId, status: "error", message, imported: 0 };
  }
}

/** Все включённые подключения по очереди (для Планировщика и кнопки «Загрузить всё»). */
export async function syncAllConnections(options: { http?: HttpClient; now?: Date; userId?: string | null } = {}): Promise<SyncOutcome[]> {
  const connections = await prisma.bankConnection.findMany({ where: { isActive: true, bankAccount: { isArchived: false } }, select: { id: true } });
  const outcomes: SyncOutcome[] = [];
  for (const c of connections) outcomes.push(await syncConnection(c.id, options));
  return outcomes;
}
