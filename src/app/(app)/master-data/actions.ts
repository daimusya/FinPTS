"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { getDictionaryConfig } from "@/lib/dictionaries/registry";
import type { FieldConfig } from "@/lib/dictionaries/types";
import { isUniqueViolation, UNIQUE_VIOLATION_MESSAGE } from "@/lib/dictionaries/errors";
import { dictionaryColumns, emptyFieldValue, type ColumnInfo } from "@/lib/dictionaries/columns";
import { getAccessScope } from "@/lib/access-scope";
import { NOT_VISIBLE } from "@/lib/access-guard";
import { ORGANIZATION_RECORD_NOT_ALLOWED, dictionaryCreateProblem, dictionaryRecordAllowed } from "@/lib/dictionaries/scope";
import type { SessionPayload } from "@/lib/session";
import type { DictionaryConfig } from "@/lib/dictionaries/types";
import { parseFormDate } from "@/lib/form-values";
import { STALE_EDIT, VERSION_FIELD, editVersion, versionMatches } from "@/lib/edit-version";

/** Запись чужой организации нельзя ни изменить, ни отправить в архив (как и увидеть в списке). */
async function visibleRecord(config: DictionaryConfig, session: SessionPayload, id: string) {
  const record = await config.delegate.findUnique({ where: { id } });
  if (!record || !dictionaryRecordAllowed(config, await getAccessScope(session), record)) throw new Error(NOT_VISIBLE);
  return record;
}

function parseField(field: FieldConfig, formData: FormData, mode: "create" | "update", column: ColumnInfo | undefined): unknown {
  if (field.type === "checkbox") {
    return formData.get(field.name) === "on";
  }
  const raw = formData.get(field.name);
  const value = raw === null ? "" : String(raw).trim();
  if (!value) {
    if (field.required) {
      throw new Error(`Поле «${field.label}» обязательно для заполнения`);
    }
    // On create an omitted key lets the DB default apply (Project.status is NOT NULL); on edit an
    // omitted key would silently keep the old value, so a nullable column is cleared with null.
    return emptyFieldValue(field, mode, column);
  }
  if (field.validate) {
    const problem = field.validate(value);
    if (problem) throw new Error(`Поле «${field.label}»: ${problem}`);
  }
  if (field.type === "number") {
    const num = Number(value.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(num)) {
      throw new Error(`Поле «${field.label}» должно быть числом`);
    }
    return num;
  }
  if (field.type === "date") {
    const parsed = parseFormDate(value, `Поле «${field.label}»`);
    if ("error" in parsed) throw new Error(parsed.error);
    return parsed.date;
  }
  return value;
}

function buildData(slug: string, formData: FormData, mode: "create" | "update"): Record<string, unknown> {
  const config = getDictionaryConfig(slug);
  const columns = dictionaryColumns(config);
  const data: Record<string, unknown> = {};
  for (const field of config.fields) {
    data[field.name] = parseField(field, formData, mode, columns.get(field.name));
  }
  return data;
}

export async function createDictionaryItem(slug: string, formData: FormData) {
  const config = getDictionaryConfig(slug);
  const session = await requirePermission(config.permissionManage);

  let data: Record<string, unknown>;
  try {
    data = buildData(slug, formData, "create");
  } catch (error) {
    redirect(`/master-data/${slug}/new?error=${encodeURIComponent((error as Error).message)}`);
  }

  const notAllowed = dictionaryCreateProblem(config, await getAccessScope(session), data!);
  if (notAllowed) redirect(`/master-data/${slug}/new?error=${encodeURIComponent(notAllowed)}`);

  const invalid = config.validateRecord ? await config.validateRecord(data!, null) : null;
  if (invalid) redirect(`/master-data/${slug}/new?error=${encodeURIComponent(invalid)}`);

  let created: Awaited<ReturnType<typeof config.delegate.create>>;
  try {
    created = await config.delegate.create({ data });
  } catch (error) {
    if (isUniqueViolation(error)) redirect(`/master-data/${slug}/new?error=${encodeURIComponent(UNIQUE_VIOLATION_MESSAGE)}`);
    throw error;
  }

  await logAudit({
    userId: session.userId,
    entityType: config.entityAuditType,
    entityId: String(created.id),
    action: "create",
    after: created as never,
  });

  revalidatePath(`/master-data/${slug}`);
  redirect(`/master-data/${slug}`);
}

export async function updateDictionaryItem(slug: string, id: string, formData: FormData) {
  const config = getDictionaryConfig(slug);
  const session = await requirePermission(config.permissionManage);

  const before = await visibleRecord(config, session, id);
  if (!versionMatches(formData.get(VERSION_FIELD), editVersion(before, config.fields.map((field) => field.name)))) {
    redirect(`/master-data/${slug}/${id}/edit?error=${encodeURIComponent(STALE_EDIT)}`);
  }

  let data: Record<string, unknown>;
  try {
    data = buildData(slug, formData, "update");
  } catch (error) {
    redirect(`/master-data/${slug}/${id}/edit?error=${encodeURIComponent((error as Error).message)}`);
  }

  if (!dictionaryRecordAllowed(config, await getAccessScope(session), { ...before, ...data! })) {
    redirect(`/master-data/${slug}/${id}/edit?error=${encodeURIComponent(ORGANIZATION_RECORD_NOT_ALLOWED)}`);
  }

  const invalid = config.validateRecord ? await config.validateRecord({ ...before, ...data! }, before) : null;
  if (invalid) redirect(`/master-data/${slug}/${id}/edit?error=${encodeURIComponent(invalid)}`);

  let updated: Awaited<ReturnType<typeof config.delegate.update>>;
  try {
    updated = await config.delegate.update({ where: { id }, data });
  } catch (error) {
    if (isUniqueViolation(error)) redirect(`/master-data/${slug}/${id}/edit?error=${encodeURIComponent(UNIQUE_VIOLATION_MESSAGE)}`);
    throw error;
  }

  await logAudit({
    userId: session.userId,
    entityType: config.entityAuditType,
    entityId: id,
    action: "update",
    before: before as never,
    after: updated as never,
  });

  revalidatePath(`/master-data/${slug}`);
  redirect(`/master-data/${slug}`);
}

export async function archiveDictionaryItem(slug: string, id: string) {
  const config = getDictionaryConfig(slug);
  const session = await requirePermission(config.permissionManage);
  await visibleRecord(config, session, id);

  const updated = await config.delegate.update({ where: { id }, data: { isArchived: true } });

  await logAudit({
    userId: session.userId,
    entityType: config.entityAuditType,
    entityId: id,
    action: "archive",
    after: updated as never,
  });

  revalidatePath(`/master-data/${slug}`);
}

export async function restoreDictionaryItem(slug: string, id: string) {
  const config = getDictionaryConfig(slug);
  const session = await requirePermission(config.permissionManage);
  await visibleRecord(config, session, id);

  const updated = await config.delegate.update({ where: { id }, data: { isArchived: false } });

  await logAudit({
    userId: session.userId,
    entityType: config.entityAuditType,
    entityId: id,
    action: "restore",
    after: updated as never,
  });

  revalidatePath(`/master-data/${slug}`);
}
