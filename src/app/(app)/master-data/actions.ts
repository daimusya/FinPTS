"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { getDictionaryConfig } from "@/lib/dictionaries/registry";
import type { FieldConfig } from "@/lib/dictionaries/types";
import { isUniqueViolation, UNIQUE_VIOLATION_MESSAGE } from "@/lib/dictionaries/errors";
import { dictionaryColumns, emptyFieldValue, type ColumnInfo } from "@/lib/dictionaries/columns";

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
    const num = Number(value);
    if (Number.isNaN(num)) {
      throw new Error(`Поле «${field.label}» должно быть числом`);
    }
    return num;
  }
  if (field.type === "date") {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Поле «${field.label}» содержит некорректную дату`);
    }
    return date;
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

  const before = await config.delegate.findUnique({ where: { id } });

  let data: Record<string, unknown>;
  try {
    data = buildData(slug, formData, "update");
  } catch (error) {
    redirect(`/master-data/${slug}/${id}/edit?error=${encodeURIComponent((error as Error).message)}`);
  }

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
