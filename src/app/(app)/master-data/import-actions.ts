"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { getDictionaryConfig } from "@/lib/dictionaries/registry";
import { resolveSheetFields } from "@/lib/dictionaries/sheet-fields";
import { parseImportRows } from "@/lib/dictionaries/spreadsheet";
import { parseSpreadsheet, type ParsedSheet } from "@/lib/bank-import/parser";
import { isUniqueViolation, UNIQUE_VIOLATION_MESSAGE } from "@/lib/dictionaries/errors";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_ERRORS_SHOWN = 15;

function backWithErrors(slug: string, errors: string[]): never {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN);
  if (errors.length > shown.length) shown.push(`…и ещё ${errors.length - shown.length}`);
  redirect(`/master-data/${slug}/import?errors=${encodeURIComponent(JSON.stringify(shown))}`);
}

/**
 * Загружает записи справочника из Excel/CSV. Всё или ничего: сначала
 * проверяются все строки, и если хоть одна с ошибкой — не создаётся ни
 * одной записи; иначе все создаются в одной транзакции.
 */
export async function importDictionaryAction(slug: string, formData: FormData) {
  const config = getDictionaryConfig(slug);
  const session = await requirePermission(config.permissionManage);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) backWithErrors(slug, ["Выберите файл"]);
  if (file.size > MAX_FILE_BYTES) backWithErrors(slug, ["Файл слишком большой (максимум 8 МБ)"]);

  let parsed: ParsedSheet;
  try {
    parsed = parseSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name);
  } catch {
    backWithErrors(slug, ["Не удалось прочитать файл. Поддерживаются XLSX, XLS, CSV"]);
  }
  if (parsed.rows.length > MAX_ROWS) backWithErrors(slug, [`Слишком много строк (максимум ${MAX_ROWS})`]);

  const fields = await resolveSheetFields(config);
  const { records, errors } = parseImportRows(fields, parsed.headers, parsed.rows);
  if (errors.length > 0) backWithErrors(slug, errors);

  // delegate.create returns Prisma's lazy query promise at runtime, so the batch runs atomically.
  try {
    await prisma.$transaction(records.map((data) => config.delegate.create({ data })) as never);
  } catch (error) {
    if (isUniqueViolation(error)) backWithErrors(slug, [`Файл не загружен: ${UNIQUE_VIOLATION_MESSAGE.toLowerCase()}`]);
    throw error;
  }

  await logAudit({
    userId: session.userId,
    entityType: config.entityAuditType,
    entityId: "import",
    action: "import",
    after: { fileName: file.name, created: records.length } as never,
  });

  revalidatePath(`/master-data/${slug}`);
  redirect(`/master-data/${slug}?imported=${records.length}`);
}
