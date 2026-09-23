"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { getDictionaryConfig } from "@/lib/dictionaries/registry";
import type { FieldConfig } from "@/lib/dictionaries/types";

function parseField(field: FieldConfig, formData: FormData): unknown {
  if (field.type === "checkbox") {
    return formData.get(field.name) === "on";
  }
  const raw = formData.get(field.name);
  const value = raw === null ? "" : String(raw).trim();
  if (!value) {
    if (field.required) {
      throw new Error(`Поле «${field.label}» обязательно для заполнения`);
    }
    // Omit rather than send null: some columns are non-nullable with a DB
    // default (e.g. Project.status) and reject an explicit null — leaving
    // the key out lets Prisma apply the column default instead.
    return field.defaultValue;
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

function buildData(slug: string, formData: FormData): Record<string, unknown> {
  const config = getDictionaryConfig(slug);
  const data: Record<string, unknown> = {};
  for (const field of config.fields) {
    data[field.name] = parseField(field, formData);
  }
  return data;
}

export async function createDictionaryItem(slug: string, formData: FormData) {
  const config = getDictionaryConfig(slug);
  const session = await requirePermission(config.permissionManage);

  let data: Record<string, unknown>;
  try {
    data = buildData(slug, formData);
  } catch (error) {
    redirect(`/master-data/${slug}/new?error=${encodeURIComponent((error as Error).message)}`);
  }

  const created = await config.delegate.create({ data });

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
    data = buildData(slug, formData);
  } catch (error) {
    redirect(`/master-data/${slug}/${id}/edit?error=${encodeURIComponent((error as Error).message)}`);
  }

  const updated = await config.delegate.update({ where: { id }, data });

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
