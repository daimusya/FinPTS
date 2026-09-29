import type Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { computeStatementFingerprints } from "./fingerprint";
import { classifyTransaction, type ClassificationRuleInput } from "./classification";

/** Операция выписки, готовая к записи: из файла или из API банка. */
export interface StatementOperation {
  date: Date;
  direction: "INFLOW" | "OUTFLOW";
  amount: Decimal | number;
  purpose: string | null;
  counterpartyInn: string | null;
  /** Номер операции банка из файла; у операций из API не задаётся — см. importStatementOperations. */
  externalRef?: string | null;
}

export interface StatementImportResult {
  batchId: string;
  imported: number;
  duplicates: number;
  autoClassified: number;
  /** Сколько одинаковых операций (одна дата, сумма и назначение) загружено как разные. */
  repeatedImported: number;
}

/**
 * Записывает операции выписки в «Банк и касса»: отпечатки для защиты от
 * дублей считаются по всей выписке (одинаковые операции нумеруются), уже
 * загруженные пропускаются, контрагент находится по ИНН, статья и разрезы —
 * по правилам классификации. Создаёт запись загрузки (BankImportBatch).
 * Один путь для файла выписки и для API банка: операции из API идут без
 * номера операции банка, по дню, направлению, сумме и назначению — так
 * операции, уже загруженные файлом, не задваиваются, и наоборот.
 */
export async function importStatementOperations(params: {
  bankAccountId: string;
  operations: StatementOperation[];
  fileName: string;
  format: string;
  importedById: string | null;
  totalRows?: number;
  errorRows?: number;
}): Promise<StatementImportResult> {
  const { bankAccountId } = params;
  const operations = params.operations.map((op) => ({ ...op, amount: toDecimal(op.amount) }));
  const batch = await prisma.bankImportBatch.create({
    data: {
      bankAccountId,
      fileName: params.fileName,
      format: params.format,
      importedById: params.importedById,
      totalRows: params.totalRows ?? operations.length,
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

  // Computed over the whole statement so identical operations without a bank reference are numbered, not merged.
  const fingerprints = computeStatementFingerprints(
    operations.map((op) => ({
      bankAccountId,
      operationDate: op.date,
      direction: op.direction,
      amount: op.amount.toFixed(2),
      purpose: op.purpose,
      externalRef: op.externalRef ?? null,
    })),
  );

  let imported = 0;
  let duplicates = 0;
  let autoClassified = 0;
  let repeatedImported = 0;
  const counterparties = new Map<string, string | null>();
  for (const [i, op] of operations.entries()) {
    const { fingerprint, occurrence } = fingerprints[i];
    if (await prisma.bankTransaction.findUnique({ where: { fingerprint } })) {
      duplicates += 1;
      continue;
    }
    if (occurrence > 1) repeatedImported += 1;

    let counterpartyId: string | null = null;
    if (op.counterpartyInn) {
      if (!counterparties.has(op.counterpartyInn)) {
        counterparties.set(op.counterpartyInn, (await prisma.counterparty.findFirst({ where: { inn: op.counterpartyInn } }))?.id ?? null);
      }
      counterpartyId = counterparties.get(op.counterpartyInn) ?? null;
    }

    const classification = classifyTransaction(ruleInputs, {
      direction: op.direction,
      purpose: op.purpose,
      counterpartyInn: op.counterpartyInn,
      amount: op.amount,
    });
    if (classification) autoClassified += 1;

    await prisma.bankTransaction.create({
      data: {
        bankAccountId,
        batchId: batch.id,
        operationDate: op.date,
        direction: op.direction,
        amount: op.amount,
        purpose: op.purpose,
        counterpartyId,
        counterpartyInn: op.counterpartyInn,
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
    data: { importedRows: imported, duplicateRows: duplicates, errorRows: params.errorRows ?? 0 },
  });
  return { batchId: batch.id, imported, duplicates, autoClassified, repeatedImported };
}
