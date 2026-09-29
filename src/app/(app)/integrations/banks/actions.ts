"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import {
  BANK_PROVIDER_LABELS,
  BankApiError,
  defaultHttpClient,
  encryptCredentials,
  isBankProvider,
  type BankCredentials,
  type BankProvider,
} from "@/lib/bank-api/core";
import { fetchStatement } from "@/lib/bank-api/providers";
import { moscowToday, syncAllConnections, syncConnection } from "@/lib/bank-api/sync";

const PAGE = "/integrations/banks";

function back(kind: "error" | "notice", message: string): never {
  redirect(`${PAGE}?${kind}=${encodeURIComponent(message)}`);
}

/** Реквизиты из формы: у Т-Банка и Точки — токен, у Сбера и Альфы — OAuth-клиент, refresh_token и сертификат. */
function readCredentials(provider: BankProvider, formData: FormData): BankCredentials | { error: string } {
  const field = (name: string) => String(formData.get(name) ?? "").trim();
  if (provider === "tbank" || provider === "tochka") {
    const token = field("token");
    return token ? { token } : { error: `Вставьте токен ${BANK_PROVIDER_LABELS[provider]}` };
  }
  const credentials: BankCredentials = {
    clientId: field("clientId"),
    clientSecret: field("clientSecret"),
    refreshToken: field("refreshToken"),
    certPath: field("certPath") || undefined,
    certPassword: field("certPassword") || undefined,
  };
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    return { error: "Для Сбера и Альфы нужны client_id, client_secret и refresh_token приложения из кабинета разработчика банка" };
  }
  return credentials;
}

/** Пробный запрос выписки за сегодня: реквизиты не сохраняются, если банк их не принимает. */
async function probe(provider: BankProvider, credentials: BankCredentials, account: { accountNumber: string; bik: string | null }): Promise<BankCredentials> {
  const today = moscowToday(new Date());
  const result = await fetchStatement(provider, credentials, account, today, today, { http: defaultHttpClient });
  return result.credentials ?? credentials;
}

export async function addBankConnectionAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  const bankAccountId = String(formData.get("bankAccountId") ?? "");
  const provider = String(formData.get("provider") ?? "");
  if (!isBankProvider(provider)) back("error", "Выберите банк");
  const account = await prisma.bankAccount.findFirst({ where: { id: bankAccountId, isArchived: false } });
  if (!account) back("error", "Выберите банковский счёт");
  if (await prisma.bankConnection.findUnique({ where: { bankAccountId } })) back("error", "Этот счёт уже подключён — замените реквизиты в его строке");
  const syncFromRaw = String(formData.get("syncFrom") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(syncFromRaw)) back("error", "Укажите, с какой даты загружать операции");
  const syncFrom = new Date(`${syncFromRaw}T00:00:00Z`);

  const credentials = readCredentials(provider as BankProvider, formData);
  if ("error" in credentials) back("error", credentials.error as string);
  let checked: BankCredentials;
  try {
    checked = await probe(provider as BankProvider, credentials as BankCredentials, account!);
  } catch (error) {
    back("error", `Подключение не сохранено: ${error instanceof BankApiError ? error.message : (error as Error).message}`);
  }

  const created = await prisma.bankConnection.create({
    data: { bankAccountId, provider, credentialsEncrypted: encryptCredentials(checked!), syncFrom, lastMessage: "Подключение проверено — выписка за сегодня получена" },
  });
  // Secrets never reach the audit log.
  await logAudit({
    userId: session.userId,
    entityType: "bank_connection",
    entityId: created.id,
    action: "create",
    after: { bankAccountId, provider, syncFrom: syncFromRaw } as never,
  });
  revalidatePath(PAGE);
  back("notice", `Счёт ${account!.accountNumber} подключён к ${BANK_PROVIDER_LABELS[provider as BankProvider]}. Нажмите «Загрузить сейчас» или дождитесь автоматической загрузки`);
}

export async function replaceBankCredentialsAction(connectionId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId }, include: { bankAccount: true } });
  if (!connection || !isBankProvider(connection.provider)) back("error", "Подключение не найдено");
  const credentials = readCredentials(connection!.provider as BankProvider, formData);
  if ("error" in credentials) back("error", credentials.error as string);
  let checked: BankCredentials;
  try {
    checked = await probe(connection!.provider as BankProvider, credentials as BankCredentials, connection!.bankAccount);
  } catch (error) {
    back("error", `Реквизиты не заменены: ${error instanceof BankApiError ? error.message : (error as Error).message}`);
  }
  await prisma.bankConnection.update({
    where: { id: connectionId },
    data: { credentialsEncrypted: encryptCredentials(checked!), lastStatus: null, lastMessage: "Реквизиты заменены и проверены" },
  });
  await logAudit({ userId: session.userId, entityType: "bank_connection", entityId: connectionId, action: "replace_credentials" });
  revalidatePath(PAGE);
  back("notice", "Реквизиты заменены и проверены");
}

export async function toggleBankConnectionAction(connectionId: string) {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
  if (!connection) back("error", "Подключение не найдено");
  await prisma.bankConnection.update({ where: { id: connectionId }, data: { isActive: !connection!.isActive } });
  await logAudit({ userId: session.userId, entityType: "bank_connection", entityId: connectionId, action: connection!.isActive ? "disable" : "enable" });
  revalidatePath(PAGE);
  back("notice", connection!.isActive ? "Автоматическая загрузка по счёту выключена" : "Автоматическая загрузка по счёту включена");
}

export async function removeBankConnectionAction(connectionId: string) {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  const connection = await prisma.bankConnection.findUnique({ where: { id: connectionId } });
  if (connection) {
    await prisma.bankConnection.delete({ where: { id: connectionId } });
    await logAudit({
      userId: session.userId,
      entityType: "bank_connection",
      entityId: connectionId,
      action: "delete",
      before: { bankAccountId: connection.bankAccountId, provider: connection.provider } as never,
    });
  }
  revalidatePath(PAGE);
  back("notice", "Подключение удалено, реквизиты стёрты. Загруженные операции остались в «Банк и касса»");
}

export async function syncBankConnectionAction(connectionId: string) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const outcome = await syncConnection(connectionId, { userId: session.userId });
  revalidatePath(PAGE);
  revalidatePath("/cash/transactions");
  back(outcome.status === "error" ? "error" : "notice", outcome.message);
}

export async function syncAllBankConnectionsAction() {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const outcomes = await syncAllConnections({ userId: session.userId });
  revalidatePath(PAGE);
  revalidatePath("/cash/transactions");
  const failed = outcomes.filter((o) => o.status === "error").length;
  const imported = outcomes.reduce((sum, o) => sum + o.imported, 0);
  back(failed ? "error" : "notice", `Счетов: ${outcomes.length}, новых операций: ${imported}${failed ? `, с ошибкой: ${failed} — подробности в строках` : ""}`);
}

