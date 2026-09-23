"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { parseSpreadsheet, type ParsedSheet } from "@/lib/bank-import/parser";
import { extractRow, type ColumnMapping, type ExtractedRow, type MappingTarget } from "@/lib/bank-import/mapping";
import { computeStatementFingerprints } from "@/lib/bank-import/fingerprint";
import { classifyTransaction, type ClassificationRuleInput } from "@/lib/bank-import/classification";

const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface ParseState {
  fileName?: string;
  bankAccountId?: string;
  headers?: string[];
  rows?: ParsedSheet["rows"];
  rowCount?: number;
  error?: string;
}

export async function parseStatementAction(_prev: ParseState, formData: FormData): Promise<ParseState> {
  await requirePermission(PERMISSIONS.CASH_MANAGE);

  const bankAccountId = String(formData.get("bankAccountId") ?? "");
  const file = formData.get("file");

  if (!bankAccountId) {
    return { error: "Выберите банковский счёт" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Выберите файл выписки", bankAccountId };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "Файл слишком большой (максимум 8 МБ)", bankAccountId };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: ParsedSheet;
  try {
    parsed = parseSpreadsheet(buffer, file.name);
  } catch {
    return { error: "Не удалось прочитать файл. Поддерживаются XLSX, XLS, CSV, TXT", bankAccountId };
  }

  if (parsed.rows.length === 0) {
    return { error: "В файле не найдено строк с данными", bankAccountId };
  }
  if (parsed.rows.length > MAX_ROWS) {
    return { error: `Слишком много строк (${parsed.rows.length}). Разбейте файл на части до ${MAX_ROWS} строк`, bankAccountId };
  }

  return {
    fileName: file.name,
    bankAccountId,
    headers: parsed.headers,
    rows: parsed.rows,
    rowCount: parsed.rows.length,
  };
}

type ValidRow = ExtractedRow & { date: Date; amount: number; direction: "INFLOW" | "OUTFLOW" };

export interface ImportState {
  done?: boolean;
  imported?: number;
  duplicates?: number;
  errors?: number;
  autoClassified?: number;
  /** Operations identical to an earlier row of the file (no bank reference) — imported as separate ones. */
  repeatedImported?: number;
  errorSamples?: string[];
  error?: string;
}

export async function importBankStatementAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const bankAccountId = String(formData.get("bankAccountId") ?? "");
  const fileName = String(formData.get("fileName") ?? "выписка");
  const headersJson = String(formData.get("headersJson") ?? "[]");
  const rowsJson = String(formData.get("rowsJson") ?? "[]");

  let headers: string[];
  let rows: Array<Array<string | number | null>>;
  try {
    headers = JSON.parse(headersJson);
    rows = JSON.parse(rowsJson);
  } catch {
    return { error: "Данные файла повреждены, загрузите файл заново" };
  }

  if (!bankAccountId || rows.length === 0) {
    return { error: "Нет данных для импорта" };
  }

  const mapping: ColumnMapping = {};
  headers.forEach((_, index) => {
    const target = String(formData.get(`map_${index}`) ?? "ignore") as MappingTarget;
    if (target !== "ignore") mapping[index] = target;
  });

  const hasDate = Object.values(mapping).includes("date");
  const hasAmount =
    Object.values(mapping).includes("amount") ||
    Object.values(mapping).includes("creditAmount") ||
    Object.values(mapping).includes("debitAmount");
  if (!hasDate || !hasAmount) {
    return { error: "Обязательно укажите колонку с датой и колонку(и) с суммой" };
  }

  const batch = await prisma.bankImportBatch.create({
    data: {
      bankAccountId,
      fileName,
      format: fileName.split(".").pop() ?? "unknown",
      importedById: session.userId,
      totalRows: rows.length,
    },
  });

  const activeRules = await prisma.bankClassificationRule.findMany({ where: { isArchived: false } });
  const ruleInputs: ClassificationRuleInput[] = activeRules.map((r) => ({
    id: r.id,
    priority: r.priority,
    direction: r.direction,
    purposeContains: r.purposeContains,
    counterpartyInn: r.counterpartyInn,
    amountEquals: r.amountEquals,
    cashFlowArticleId: r.cashFlowArticleId,
    departmentId: r.departmentId,
    costCenterId: r.costCenterId,
    projectId: r.projectId,
    productServiceId: r.productServiceId,
  }));

  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  let autoClassified = 0;
  let repeatedImported = 0;
  const errorSamples: string[] = [];

  const valid: ValidRow[] = [];
  rows.forEach((row, i) => {
    const extracted = extractRow(row, mapping);
    if (!extracted.date || !extracted.amount || !extracted.direction) {
      errors += 1;
      if (errorSamples.length < 10) errorSamples.push(`Строка ${i + 2}: нет даты или суммы`);
      return;
    }
    valid.push(extracted as ValidRow);
  });
  // Computed over the whole file so identical operations without a bank reference are numbered, not merged.
  const fingerprints = computeStatementFingerprints(
    valid.map((extracted) => ({
      bankAccountId,
      operationDate: extracted.date,
      direction: extracted.direction,
      amount: extracted.amount.toFixed(2),
      purpose: extracted.purpose,
      externalRef: extracted.externalRef,
    })),
  );

  for (const [i, extracted] of valid.entries()) {
    const { fingerprint, occurrence } = fingerprints[i];
    const existing = await prisma.bankTransaction.findUnique({ where: { fingerprint } });
    if (existing) {
      duplicates += 1;
      continue;
    }
    if (occurrence > 1) repeatedImported += 1;

    let counterpartyId: string | null = null;
    if (extracted.counterpartyInn) {
      const counterparty = await prisma.counterparty.findFirst({ where: { inn: extracted.counterpartyInn } });
      counterpartyId = counterparty?.id ?? null;
    }

    const classification = classifyTransaction(ruleInputs, {
      direction: extracted.direction,
      purpose: extracted.purpose,
      counterpartyInn: extracted.counterpartyInn,
      amount: extracted.amount,
    });
    if (classification) autoClassified += 1;

    await prisma.bankTransaction.create({
      data: {
        bankAccountId,
        batchId: batch.id,
        operationDate: extracted.date,
        direction: extracted.direction,
        amount: extracted.amount,
        purpose: extracted.purpose,
        counterpartyId,
        fingerprint,
        cashFlowArticleId: classification?.cashFlowArticleId ?? null,
        departmentId: classification?.departmentId ?? null,
        costCenterId: classification?.costCenterId ?? null,
        projectId: classification?.projectId ?? null,
        productServiceId: classification?.productServiceId ?? null,
      },
    });
    imported += 1;
  }

  await prisma.bankImportBatch.update({
    where: { id: batch.id },
    data: { importedRows: imported, duplicateRows: duplicates, errorRows: errors },
  });

  await logAudit({
    userId: session.userId,
    entityType: "bank_import_batch",
    entityId: batch.id,
    action: "import",
    after: { fileName, imported, duplicates, errors, autoClassified, repeatedImported } as never,
  });

  revalidatePath("/cash/transactions");

  return { done: true, imported, duplicates, errors, autoClassified, repeatedImported, errorSamples };
}
