import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate } from "@/lib/period";
import { recomputeAccrualDocumentStatus } from "@/lib/matching";
import { ONEC_REQUIRED_TARGETS, type OnecColumnMapping } from "./onec-mapping";
import { describeRows, groupOnecRows, type OnecDocumentGroup, type OnecLine } from "./onec-grouping";
import { AccrualDocumentStatus } from "@prisma/client";
import { enqueueProjectResultsForDocument } from "./project-results";

export interface OnecImportResult {
  batchId: string;
  imported: number;
  updated: number;
  /** Строк начисления в созданных и обновлённых документах. */
  lines: number;
  errors: number;
  errorSamples: string[];
}

type LineRefs = {
  pnlArticleId: string;
  departmentId: string | null;
  costCenterId: string | null;
  projectId: string | null;
  productServiceId: string | null;
};

const insensitive = (value: string) => ({ equals: value, mode: "insensitive" as const });

/**
 * Находит ссылки строки: статью ОПиУ — по коду или названию, подразделение —
 * по названию, ЦФО, проект и продукт/услугу — по названию или коду (проект —
 * в организации документа). Незнакомое значение — ошибка документа, а не
 * тихо пустая аналитика.
 */
async function resolveLine(line: OnecLine, organizationId: string): Promise<LineRefs> {
  const pnlArticle = await prisma.pnlArticle.findFirst({
    where: { isArchived: false, OR: [{ code: line.pnlArticleCode }, { name: insensitive(line.pnlArticleCode) }] },
  });
  if (!pnlArticle) throw new Error(`статья ОПиУ «${line.pnlArticleCode}» не найдена (строка ${line.rowNumber})`);

  const lookup = async <T extends { id: string } | null>(value: string | null, label: string, find: (v: string) => Promise<T>) => {
    if (!value) return null;
    const found = await find(value);
    if (!found) throw new Error(`в справочнике нет значения «${value}» (${label}, строка ${line.rowNumber})`);
    return found.id;
  };

  return {
    pnlArticleId: pnlArticle.id,
    departmentId: await lookup(line.departmentName, "подразделение", (v) =>
      prisma.department.findFirst({ where: { isArchived: false, name: insensitive(v) } }),
    ),
    costCenterId: await lookup(line.costCenterName, "ЦФО", (v) =>
      prisma.costCenter.findFirst({ where: { isArchived: false, OR: [{ name: insensitive(v) }, { code: v }] } }),
    ),
    projectId: await lookup(line.projectName, "проект", (v) =>
      prisma.project.findFirst({ where: { isArchived: false, organizationId, OR: [{ name: insensitive(v) }, { code: v }] } }),
    ),
    productServiceId: await lookup(line.productServiceName, "продукт/услуга", (v) =>
      prisma.productService.findFirst({ where: { isArchived: false, OR: [{ name: insensitive(v) }, { code: v }] } }),
    ),
  };
}

async function importDocument(doc: OnecDocumentGroup, batchId: string): Promise<"created" | "updated"> {
  const h = doc.header;
  const organization = await prisma.organization.findFirst({ where: { inn: h.organizationInn! } });
  if (!organization) throw new Error(`организация с ИНН «${h.organizationInn}» не найдена в платформе`);

  let counterparty = await prisma.counterparty.findFirst({ where: { inn: h.counterpartyInn! } });
  if (!counterparty) {
    counterparty = await prisma.counterparty.create({
      data: {
        inn: h.counterpartyInn!,
        fullName: h.counterpartyName ?? `Контрагент ИНН ${h.counterpartyInn}`,
        dataSource: "1C",
        dataUpdatedAt: new Date(),
      },
    });
  }

  const lineRefs: LineRefs[] = [];
  for (const line of doc.lines) lineRefs.push(await resolveLine(line, organization.id));
  const lines = doc.lines.map((line, i) => ({
    ...lineRefs[i],
    amount: line.amount,
    vatAmount: line.vatAmount,
    description: line.description,
  }));

  await assertPeriodOpenForDate(h.date!);
  const header = {
    organizationId: organization.id,
    counterpartyId: counterparty.id,
    number: h.number!,
    date: h.date!,
    documentType: h.documentType as never,
    direction: h.direction as never,
    dueDate: h.dueDate,
    comment: h.comment,
  };

  const existingLink = await prisma.integrationExternalObject.findUnique({
    where: {
      sourceSystem_sourceEntityType_externalId: { sourceSystem: "1C", sourceEntityType: "accrual_document", externalId: doc.externalId },
    },
  });

  if (existingLink?.accrualDocumentId) {
    const existingDoc = await prisma.accrualDocument.findUniqueOrThrow({ where: { id: existingLink.accrualDocumentId } });
    await assertPeriodOpenForDate(existingDoc.date);
    // Re-import replaces every line, so lines removed from the 1C document disappear here too.
    await prisma.$transaction(async (tx) => {
      await tx.accrualDocumentLine.deleteMany({ where: { documentId: existingDoc.id } });
      await tx.accrualDocument.update({ where: { id: existingDoc.id }, data: { ...header, lines: { create: lines } } });
      await tx.integrationExternalObject.update({ where: { id: existingLink.id }, data: { batchId, status: "synced" } });
    });
    await recomputeAccrualDocumentStatus(existingDoc.id);
    return "updated";
  }

  const createdId = await prisma.$transaction(async (tx) => {
    const created = await tx.accrualDocument.create({
      data: {
        ...header,
        status: AccrualDocumentStatus.POSTED,
        sourceSystem: "1C",
        externalId: doc.externalId,
        lines: { create: lines },
      },
    });
    await tx.integrationExternalObject.create({
      data: {
        batchId,
        sourceSystem: "1C",
        sourceEntityType: "accrual_document",
        externalId: doc.externalId,
        localEntityType: "accrual_document",
        localEntityId: created.id,
        accrualDocumentId: created.id,
        status: "synced",
      },
    });
    return created.id;
  });
  await enqueueProjectResultsForDocument(createdId);
  return "created";
}

/**
 * Импорт документов начисления из табличной выгрузки 1С. Строки с одним
 * внешним ID — один документ с несколькими строками (см. groupOnecRows).
 * Идемпотентно: документ с уже известным внешним ID обновляется целиком.
 * Ошибка отклоняет только свой документ, остальные загружаются.
 */
export async function importOnecDocuments(params: {
  profileId: string;
  userId: string;
  fileName: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  mapping: OnecColumnMapping;
}): Promise<OnecImportResult> {
  const mappedTargets = new Set(Object.values(params.mapping));
  const missing = ONEC_REQUIRED_TARGETS.filter((t) => !mappedTargets.has(t));
  if (missing.length > 0) {
    throw new Error(`Не сопоставлены обязательные колонки: ${missing.join(", ")}`);
  }

  const batch = await prisma.integrationBatch.create({
    data: { integrationProfileId: params.profileId, fileName: params.fileName, status: "running" },
  });

  const { documents, errors: groupErrors } = groupOnecRows(params.rows, params.mapping);
  let imported = 0;
  let updated = 0;
  let lines = 0;
  const errorLog: Array<{ row: number; message: string }> = [];
  const addError = (rowNumbers: number[], externalId: string | null, message: string) => {
    const where = externalId ? `Документ ${externalId} (${describeRows(rowNumbers)})` : describeRows(rowNumbers);
    errorLog.push({ row: rowNumbers[0], message: `${where}: ${message}` });
  };
  for (const e of groupErrors) addError(e.rowNumbers, e.externalId, e.message);

  for (const doc of documents) {
    try {
      const outcome = await importDocument(doc, batch.id);
      if (outcome === "created") imported += 1;
      else updated += 1;
      lines += doc.lines.length;
    } catch (error) {
      addError(doc.rowNumbers, doc.externalId, error instanceof Error ? error.message : "неизвестная ошибка");
    }
  }

  errorLog.sort((a, b) => a.row - b.row);
  await prisma.integrationBatch.update({
    where: { id: batch.id },
    data: {
      status: "completed",
      importedCount: imported,
      updatedCount: updated,
      errorCount: errorLog.length,
      finishedAt: new Date(),
      errorLog: errorLog.length > 0 ? errorLog : undefined,
    },
  });

  await logAudit({
    userId: params.userId,
    entityType: "integration_batch",
    entityId: batch.id,
    action: "import_1c",
    after: { fileName: params.fileName, imported, updated, lines, errors: errorLog.length } as never,
  });

  return {
    batchId: batch.id,
    imported,
    updated,
    lines,
    errors: errorLog.length,
    errorSamples: errorLog.slice(0, 15).map((e) => e.message),
  };
}
