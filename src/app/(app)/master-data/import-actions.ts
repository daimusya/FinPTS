"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { getDictionaryConfig } from "@/lib/dictionaries/registry";
import { resolveSheetFields } from "@/lib/dictionaries/sheet-fields";
import { parseImportRows } from "@/lib/dictionaries/spreadsheet";
import { planImport, type ImportMode } from "@/lib/dictionaries/import-plan";
import { dictionaryColumns, dictionaryModelKey, emptyFieldValue } from "@/lib/dictionaries/columns";
import { BANK_SHEET, CONTACT_SHEET, planDetails, type DetailsPlan } from "@/lib/counterparties/details-sheets";
import { parseWorkbookSheets } from "@/lib/bank-import/parser";
import { isUniqueViolation, UNIQUE_VIOLATION_MESSAGE } from "@/lib/dictionaries/errors";
import { getAccessScope } from "@/lib/access-scope";
import { ORGANIZATION_RECORD_NOT_ALLOWED, dictionaryCreateProblem, dictionaryRecordAllowed, dictionaryScopeWhere } from "@/lib/dictionaries/scope";

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_ERRORS_SHOWN = 15;
const MAX_PREVIEW_LINES = 20;

function backWithErrors(slug: string, errors: string[]): never {
  const shown = errors.slice(0, MAX_ERRORS_SHOWN);
  if (errors.length > shown.length) shown.push(`…и ещё ${errors.length - shown.length}`);
  redirect(`/master-data/${slug}/import?errors=${encodeURIComponent(JSON.stringify(shown))}`);
}

export interface ImportPreview {
  fileName: string;
  mode: ImportMode;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  archived: number;
  archiveMissing: boolean;
  details: { bankCreated: number; bankUpdated: number; contactCreated: number; contactUpdated: number } | null;
  lines: string[];
}

type Model = {
  create: (args: unknown) => Promise<{ id: string }>;
  update: (args: unknown) => Promise<unknown>;
};

/**
 * Загрузка справочника из Excel/CSV. Строка с «ID записи» обновляет эту
 * запись, строка без ID ищет существующую по ИНН, коду или названию, иначе
 * создаёт новую; обновляются только изменившиеся поля. Всё или ничего:
 * сначала проверяется весь файл (включая дубли внутри него), и при любой
 * ошибке ничего не меняется; иначе все изменения — одной транзакцией.
 * Ошибки в ячейках и ошибки сопоставления (дубли, неоднозначные ключи)
 * собираются за один проход. По флажку «убрать отсутствующие» действующие
 * записи, которых нет в файле, отправляются в архив (удаления в
 * справочниках нет — архив и есть удаление, его можно отменить).
 * «Проверить» показывает план без сохранения. У контрагентов загружаются и
 * листы «Банковские реквизиты» и «Контакты», если они есть в файле.
 */
export async function importDictionaryAction(slug: string, formData: FormData) {
  const config = getDictionaryConfig(slug);
  const session = await requirePermission(config.permissionManage);
  const mode: ImportMode = formData.get("mode") === "create-only" ? "create-only" : "upsert";
  const dryRun = formData.get("intent") === "check";
  const archiveMissing = mode === "upsert" && formData.get("archiveMissing") === "on";

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) backWithErrors(slug, ["Выберите файл"]);
  if (file.size > MAX_FILE_BYTES) backWithErrors(slug, ["Файл слишком большой (максимум 8 МБ)"]);

  let sheets: ReturnType<typeof parseWorkbookSheets>;
  try {
    sheets = parseWorkbookSheets(Buffer.from(await file.arrayBuffer()), file.name);
  } catch {
    backWithErrors(slug, ["Не удалось прочитать файл. Поддерживаются XLSX, XLS, CSV"]);
  }
  // The main sheet is the one named like the dictionary (as in the export), otherwise the first one.
  const main = (sheets.find((s) => s.name === config.title) ?? sheets.find((s) => s.name !== BANK_SHEET && s.name !== CONTACT_SHEET) ?? sheets[0])?.sheet;
  if (!main) backWithErrors(slug, ["В файле нет листов"]);
  if (main.rows.length > MAX_ROWS) backWithErrors(slug, [`Слишком много строк (максимум ${MAX_ROWS})`]);

  const fields = await resolveSheetFields(config);
  const parsed = parseImportRows(fields, main.headers, main.rows);
  // Missing columns or an empty file — nothing to match; otherwise cell errors are reported together with the rest.
  if (parsed.errors.length > 0 && parsed.rows.length === 0) backWithErrors(slug, parsed.errors);

  const columns = dictionaryColumns(config);
  // Records of other organizations are neither matched, nor updated, nor archived as «missing from the file».
  const scope = await getAccessScope(session);
  const existingItems = await config.delegate.findMany({ where: dictionaryScopeWhere(config, scope) });
  const plan = planImport({
    fields,
    rows: parsed.rows,
    existing: existingItems.map((item) => ({ id: String(item.id), isArchived: Boolean(item.isArchived), values: item })),
    mode,
    clearValue: (name) => emptyFieldValue(fields.find((f) => f.name === name) ?? {}, "update", columns.get(name)),
    archiveMissing,
  });

  let details: DetailsPlan | null = null;
  if (slug === "counterparties") {
    const bankSheet = sheets.find((s) => s.name === BANK_SHEET)?.sheet ?? null;
    const contactSheet = sheets.find((s) => s.name === CONTACT_SHEET)?.sheet ?? null;
    if (bankSheet || contactSheet) {
      const [bankDetails, contacts] = await Promise.all([prisma.counterpartyBankDetail.findMany(), prisma.counterpartyContact.findMany()]);
      details = planDetails({
        bankSheet,
        contactSheet,
        owners: [
          ...existingItems.map((c) => ({
            ref: String(c.id),
            inn: (c.inn as string | null) ?? null,
            names: [c.fullName, c.shortName].filter(Boolean).map(String),
          })),
          ...[...plan.creates, ...plan.pendingCreates].map((c) => ({
            ref: `new:${c.line}`,
            inn: (c.data.inn as string | undefined) ?? null,
            names: [c.data.fullName, c.data.shortName].filter(Boolean).map(String),
          })),
        ],
        bankDetails,
        contacts,
        mode,
      });
    }
  }

  // One list, in file order: cell errors and matching errors of the main sheet, then the other sheets.
  const lineOf = (e: string) => Number(/^Строк[аи] (\d+)/.exec(e)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const scopeErrors: string[] = [];
  const visibleById = new Map(existingItems.map((item) => [String(item.id), item]));
  for (const c of [...plan.creates, ...plan.pendingCreates]) {
    const problem = dictionaryCreateProblem(config, scope, c.data);
    if (problem) scopeErrors.push(`Строка ${c.line}: ${problem}`);
  }
  for (const u of plan.updates) {
    if (!dictionaryRecordAllowed(config, scope, { ...visibleById.get(u.id), ...u.data })) scopeErrors.push(`Строка ${u.line}: ${ORGANIZATION_RECORD_NOT_ALLOWED}`);
  }
  const errors = [...[...parsed.errors, ...plan.errors, ...scopeErrors].sort((a, b) => lineOf(a) - lineOf(b)), ...(details?.errors ?? [])];
  // Whole-record checks of the dictionary (for example, closed periods for fixed assets) — row by row.
  if (config.validateRecord && errors.length === 0) {
    const byId = new Map(existingItems.map((item) => [String(item.id), item]));
    for (const c of plan.creates) {
      const problem = await config.validateRecord(c.data, null);
      if (problem) errors.push(`Строка ${c.line}: ${problem}`);
    }
    for (const u of plan.updates) {
      const before = byId.get(u.id) ?? null;
      const problem = await config.validateRecord({ ...before, ...u.data }, before);
      if (problem) errors.push(`Строка ${u.line}: ${problem}`);
    }
    for (const a of plan.archives) {
      const before = byId.get(a.id) ?? null;
      const problem = await config.validateRecord({ ...before, isArchived: true }, before);
      if (problem) errors.push(`«${a.label}» (нет в файле): ${problem}`);
    }
  }
  if (errors.length > 0) backWithErrors(slug, errors);

  if (dryRun) {
    const lines = [
      ...[
        ...plan.updates.map((u) => `Строка ${u.line}: обновится «${u.label}» — ${u.changed.join(", ")}`),
        ...plan.creates.map((c) => `Строка ${c.line}: будет создана «${c.label}»`),
      ].sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0])),
      ...plan.archives.map((a) => `Нет в файле — уйдёт в архив: «${a.label}»`),
    ];
    const preview: ImportPreview = {
      fileName: file.name,
      mode,
      created: plan.creates.length,
      updated: plan.updates.length,
      unchanged: plan.unchanged,
      skipped: plan.skipped,
      archived: plan.archives.length,
      archiveMissing,
      details: details
        ? {
            bankCreated: details.bankCreates.length,
            bankUpdated: details.bankUpdates.length,
            contactCreated: details.contactCreates.length,
            contactUpdated: details.contactUpdates.length,
          }
        : null,
      lines: lines.length > MAX_PREVIEW_LINES ? [...lines.slice(0, MAX_PREVIEW_LINES), `…и ещё ${lines.length - MAX_PREVIEW_LINES}`] : lines,
    };
    redirect(`/master-data/${slug}/import?preview=${encodeURIComponent(JSON.stringify(preview))}`);
  }

  const modelKey = dictionaryModelKey(config);
  try {
    await prisma.$transaction(
      async (db) => {
        const model = (db as unknown as Record<string, Model>)[modelKey];
        const createdIds = new Map<string, string>();
        for (const c of plan.creates) createdIds.set(`new:${c.line}`, (await model.create({ data: c.data })).id);
        for (const u of plan.updates) await model.update({ where: { id: u.id }, data: u.data });
        for (const a of plan.archives) await model.update({ where: { id: a.id }, data: { isArchived: true } });
        if (details) await applyDetails(db, details, (ref) => createdIds.get(ref) ?? ref);
      },
      { timeout: 60_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) backWithErrors(slug, [`Файл не загружен: ${UNIQUE_VIOLATION_MESSAGE.toLowerCase()}`]);
    throw error;
  }

  const summary = {
    fileName: file.name,
    mode,
    created: plan.creates.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged,
    skipped: plan.skipped,
    archived: plan.archives.length,
    ...(details
      ? {
          bankCreated: details.bankCreates.length,
          bankUpdated: details.bankUpdates.length,
          contactCreated: details.contactCreates.length,
          contactUpdated: details.contactUpdates.length,
        }
      : {}),
  };
  await logAudit({
    userId: session.userId,
    entityType: config.entityAuditType,
    entityId: "import",
    action: "import",
    after: { ...summary, updatedIds: plan.updates.map((u) => u.id), archivedIds: plan.archives.map((a) => a.id) } as never,
  });

  revalidatePath(`/master-data/${slug}`);
  const parts = [`создано ${summary.created}`, `обновлено ${summary.updated}`, `без изменений ${summary.unchanged}`];
  if (summary.skipped) parts.push(`пропущено существующих ${summary.skipped}`);
  if (summary.archived) parts.push(`в архив (нет в файле) ${summary.archived}`);
  if (details) {
    parts.push(
      `реквизиты: +${details.bankCreates.length}, изменено ${details.bankUpdates.length}`,
      `контакты: +${details.contactCreates.length}, изменено ${details.contactUpdates.length}`,
    );
  }
  redirect(`/master-data/${slug}?importResult=${encodeURIComponent(`Файл «${file.name}» загружен: ${parts.join(", ")}.`)}`);
}

/** Реквизиты и контакты; у каждого затронутого контрагента после загрузки ровно один основной счёт и один основной контакт. */
async function applyDetails(db: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], plan: DetailsPlan, idOf: (ref: string) => string) {
  const touched = new Set<string>();
  const makePrimary = new Map<string, string>();
  for (const c of plan.bankCreates) {
    const counterpartyId = idOf(c.owner);
    const created = await db.counterpartyBankDetail.create({ data: { counterpartyId, ...c.data, isPrimary: false } });
    touched.add(counterpartyId);
    if (c.primary) makePrimary.set(counterpartyId, created.id);
  }
  for (const u of plan.bankUpdates) {
    const counterpartyId = idOf(u.owner);
    await db.counterpartyBankDetail.update({ where: { id: u.id }, data: u.data });
    touched.add(counterpartyId);
    if (u.primary) makePrimary.set(counterpartyId, u.id);
  }
  for (const [counterpartyId, id] of makePrimary) {
    await db.counterpartyBankDetail.updateMany({ where: { counterpartyId, id: { not: id } }, data: { isPrimary: false } });
    await db.counterpartyBankDetail.update({ where: { id }, data: { isPrimary: true } });
  }
  for (const counterpartyId of touched) {
    const hasPrimary = await db.counterpartyBankDetail.count({ where: { counterpartyId, isPrimary: true } });
    if (hasPrimary) continue;
    const first = await db.counterpartyBankDetail.findFirst({ where: { counterpartyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (first) await db.counterpartyBankDetail.update({ where: { id: first.id }, data: { isPrimary: true } });
  }
  const touchedContacts = new Set<string>();
  const primaryContact = new Map<string, string>();
  for (const c of plan.contactCreates) {
    const counterpartyId = idOf(c.owner);
    const created = await db.counterpartyContact.create({ data: { counterpartyId, ...c.data, isPrimary: false } });
    touchedContacts.add(counterpartyId);
    if (c.primary) primaryContact.set(counterpartyId, created.id);
  }
  for (const u of plan.contactUpdates) {
    const counterpartyId = idOf(u.owner);
    await db.counterpartyContact.update({ where: { id: u.id }, data: u.data });
    touchedContacts.add(counterpartyId);
    if (u.primary) primaryContact.set(counterpartyId, u.id);
  }
  for (const [counterpartyId, id] of primaryContact) {
    await db.counterpartyContact.updateMany({ where: { counterpartyId, id: { not: id } }, data: { isPrimary: false } });
    await db.counterpartyContact.update({ where: { id }, data: { isPrimary: true } });
  }
  for (const counterpartyId of touchedContacts) {
    const hasPrimary = await db.counterpartyContact.count({ where: { counterpartyId, isPrimary: true } });
    if (hasPrimary) continue;
    const first = await db.counterpartyContact.findFirst({ where: { counterpartyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (first) await db.counterpartyContact.update({ where: { id: first.id }, data: { isPrimary: true } });
  }
}
