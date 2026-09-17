import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate } from "@/lib/period";
import { recomputeAccrualDocumentStatus } from "@/lib/matching";
import { extractOnecRow, ONEC_REQUIRED_TARGETS, type OnecColumnMapping } from "./onec-mapping";
import { AccrualDocumentStatus } from "@prisma/client";

const DOCUMENT_TYPES = new Set([
  "INVOICE", "ACT", "UPD", "WAYBILL", "SALE", "RECEIPT", "RETURN", "CORRECTION", "MANUAL",
]);
const DIRECTIONS = new Set(["INCOME", "EXPENSE"]);

export interface OnecImportResult {
  batchId: string;
  imported: number;
  updated: number;
  errors: number;
  errorSamples: string[];
}

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
    data: {
      integrationProfileId: params.profileId,
      fileName: params.fileName,
      status: "running",
    },
  });

  let imported = 0;
  let updated = 0;
  let errors = 0;
  const errorSamples: string[] = [];
  const errorLog: Array<{ row: number; message: string }> = [];

  for (let i = 0; i < params.rows.length; i += 1) {
    const rowNum = i + 2; // +1 for header, +1 for 1-based
    try {
      const extracted = extractOnecRow(params.rows[i], params.mapping);

      if (!extracted.externalId || !extracted.number || !extracted.date || !extracted.amount) {
        throw new Error("не заполнены обязательные поля (внешний ID, номер, дата, сумма)");
      }
      if (!extracted.documentType || !DOCUMENT_TYPES.has(extracted.documentType)) {
        throw new Error(`неизвестный тип документа «${extracted.documentType}»`);
      }
      if (!extracted.direction || !DIRECTIONS.has(extracted.direction)) {
        throw new Error(`направление должно быть INCOME или EXPENSE, получено «${extracted.direction}»`);
      }

      const organization = extracted.organizationInn
        ? await prisma.organization.findFirst({ where: { inn: extracted.organizationInn } })
        : null;
      if (!organization) {
        throw new Error(`организация с ИНН «${extracted.organizationInn}» не найдена в платформе`);
      }

      let counterparty = extracted.counterpartyInn
        ? await prisma.counterparty.findFirst({ where: { inn: extracted.counterpartyInn } })
        : null;
      if (!counterparty && extracted.counterpartyInn) {
        counterparty = await prisma.counterparty.create({
          data: {
            inn: extracted.counterpartyInn,
            fullName: extracted.counterpartyName ?? `Контрагент ИНН ${extracted.counterpartyInn}`,
            dataSource: "1C",
            dataUpdatedAt: new Date(),
          },
        });
      }
      if (!counterparty) {
        throw new Error("не указан ИНН контрагента");
      }

      const pnlArticle = extracted.pnlArticleCode
        ? await prisma.pnlArticle.findFirst({
            where: { OR: [{ code: extracted.pnlArticleCode }, { name: extracted.pnlArticleCode }] },
          })
        : null;
      if (!pnlArticle) {
        throw new Error(`статья ОПиУ «${extracted.pnlArticleCode}» не найдена`);
      }

      await assertPeriodOpenForDate(extracted.date);

      const existingLink = await prisma.integrationExternalObject.findUnique({
        where: {
          sourceSystem_sourceEntityType_externalId: {
            sourceSystem: "1C",
            sourceEntityType: "accrual_document",
            externalId: extracted.externalId,
          },
        },
      });

      if (existingLink?.accrualDocumentId) {
        const existingDoc = await prisma.accrualDocument.findUniqueOrThrow({
          where: { id: existingLink.accrualDocumentId },
          include: { lines: true },
        });
        await assertPeriodOpenForDate(existingDoc.date);

        await prisma.$transaction(async (tx) => {
          await tx.accrualDocumentLine.deleteMany({ where: { documentId: existingDoc.id } });
          await tx.accrualDocument.update({
            where: { id: existingDoc.id },
            data: {
              organizationId: organization.id,
              counterpartyId: counterparty.id,
              number: extracted.number!,
              date: extracted.date!,
              documentType: extracted.documentType as never,
              direction: extracted.direction as never,
              dueDate: extracted.dueDate,
              comment: extracted.comment,
              lines: {
                create: [{ pnlArticleId: pnlArticle.id, amount: extracted.amount!, vatAmount: extracted.vatAmount }],
              },
            },
          });
        });
        await recomputeAccrualDocumentStatus(existingDoc.id);
        await prisma.integrationExternalObject.update({
          where: { id: existingLink.id },
          data: { batchId: batch.id, status: "synced" },
        });
        updated += 1;
      } else {
        const created = await prisma.accrualDocument.create({
          data: {
            organizationId: organization.id,
            counterpartyId: counterparty.id,
            number: extracted.number,
            date: extracted.date,
            documentType: extracted.documentType as never,
            direction: extracted.direction as never,
            dueDate: extracted.dueDate,
            comment: extracted.comment,
            status: AccrualDocumentStatus.POSTED,
            sourceSystem: "1C",
            externalId: extracted.externalId,
            lines: {
              create: [{ pnlArticleId: pnlArticle.id, amount: extracted.amount, vatAmount: extracted.vatAmount }],
            },
          },
        });
        await prisma.integrationExternalObject.create({
          data: {
            batchId: batch.id,
            sourceSystem: "1C",
            sourceEntityType: "accrual_document",
            externalId: extracted.externalId,
            localEntityType: "accrual_document",
            localEntityId: created.id,
            accrualDocumentId: created.id,
            status: "synced",
          },
        });
        imported += 1;
      }
    } catch (error) {
      errors += 1;
      const message = error instanceof Error ? error.message : "неизвестная ошибка";
      errorLog.push({ row: rowNum, message });
      if (errorSamples.length < 15) errorSamples.push(`Строка ${rowNum}: ${message}`);
    }
  }

  await prisma.integrationBatch.update({
    where: { id: batch.id },
    data: {
      status: "completed",
      importedCount: imported,
      updatedCount: updated,
      errorCount: errors,
      finishedAt: new Date(),
      errorLog: errorLog.length > 0 ? errorLog : undefined,
    },
  });

  await logAudit({
    userId: params.userId,
    entityType: "integration_batch",
    entityId: batch.id,
    action: "import_1c",
    after: { fileName: params.fileName, imported, updated, errors } as never,
  });

  return { batchId: batch.id, imported, updated, errors, errorSamples };
}
