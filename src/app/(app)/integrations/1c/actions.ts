"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { parseSpreadsheet, type ParsedSheet } from "@/lib/bank-import/parser";
import { importOnecDocuments } from "@/lib/integrations/onec-import";
import type { OnecColumnMapping, OnecMappingTarget } from "@/lib/integrations/onec-mapping";

const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface OnecParseState {
  fileName?: string;
  headers?: string[];
  rows?: ParsedSheet["rows"];
  rowCount?: number;
  error?: string;
}

export async function parseOnecFileAction(_prev: OnecParseState, formData: FormData): Promise<OnecParseState> {
  await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Выберите файл выгрузки из 1С" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { error: "Файл слишком большой (максимум 8 МБ)" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let parsed: ParsedSheet;
  try {
    parsed = parseSpreadsheet(buffer, file.name);
  } catch {
    return { error: "Не удалось прочитать файл. В этой версии поддерживаются табличные XLSX, CSV, TXT (XML/JSON — не поддерживаются)" };
  }
  if (parsed.rows.length === 0) {
    return { error: "В файле не найдено строк с данными" };
  }
  if (parsed.rows.length > MAX_ROWS) {
    return { error: `Слишком много строк (${parsed.rows.length}). Разбейте файл на части до ${MAX_ROWS} строк` };
  }

  return { fileName: file.name, headers: parsed.headers, rows: parsed.rows, rowCount: parsed.rows.length };
}

export interface OnecImportState {
  done?: boolean;
  imported?: number;
  updated?: number;
  lines?: number;
  errors?: number;
  errorSamples?: string[];
  error?: string;
}

async function getOrCreateProfile(): Promise<string> {
  const existing = await prisma.integrationProfile.findFirst({ where: { system: "1C" } });
  if (existing) return existing.id;
  const created = await prisma.integrationProfile.create({
    data: { system: "1C", name: "1С:Бухгалтерия (файловый обмен)", isEnabled: true },
  });
  return created.id;
}

export async function importOnecFileAction(_prev: OnecImportState, formData: FormData): Promise<OnecImportState> {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);

  const fileName = String(formData.get("fileName") ?? "1c-import");
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
  if (rows.length === 0) {
    return { error: "Нет данных для импорта" };
  }

  const mapping: OnecColumnMapping = {};
  headers.forEach((_, index) => {
    const target = String(formData.get(`map_${index}`) ?? "ignore") as OnecMappingTarget;
    if (target !== "ignore") mapping[index] = target;
  });

  const profileId = await getOrCreateProfile();

  try {
    const result = await importOnecDocuments({
      profileId,
      userId: session.userId,
      fileName,
      headers,
      rows,
      mapping,
    });
    revalidatePath("/integrations/1c");
    revalidatePath("/accruals");
    return {
      done: true,
      imported: result.imported,
      updated: result.updated,
      lines: result.lines,
      errors: result.errors,
      errorSamples: result.errorSamples,
    };
  } catch (error) {
    return { error: (error as Error).message };
  }
}
