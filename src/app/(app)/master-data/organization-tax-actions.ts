"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { isTaxSystem, missingStandardRates, parseTaxRateForm, TAX_KIND_LABELS, type TaxKind } from "@/lib/organizations/taxes";
import { isUniqueViolation } from "@/lib/dictionaries/errors";

function editPath(organizationId: string) {
  return `/master-data/organizations/${organizationId}/edit`;
}

/** Back to the organization card, to the taxes block, with a message shown there. */
function back(organizationId: string, kind: "error" | "notice", message: string, keepEditing?: string): never {
  const edit = keepEditing ? `&editTaxRate=${encodeURIComponent(keepEditing)}` : "";
  redirect(`${editPath(organizationId)}?tax${kind === "error" ? "Error" : "Notice"}=${encodeURIComponent(message)}${edit}#taxes`);
}

function readForm(formData: FormData) {
  return parseTaxRateForm({
    taxKind: String(formData.get("taxKind") ?? ""),
    ratePct: String(formData.get("ratePct") ?? ""),
    validFrom: String(formData.get("validFrom") ?? ""),
    comment: String(formData.get("comment") ?? ""),
  });
}

const DUPLICATE = "У этого налога уже есть ставка с такой даты — измените её или выберите другую дату";

export async function addTaxRateAction(organizationId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const result = readForm(formData);
  if ("error" in result) back(organizationId, "error", result.error);
  const value = (result as Extract<typeof result, { value: unknown }>).value;

  let created;
  try {
    created = await prisma.organizationTaxRate.create({ data: { organizationId, ...value, ratePct: value.ratePct.toFixed(3) } });
  } catch (error) {
    if (isUniqueViolation(error)) back(organizationId, "error", DUPLICATE);
    throw error;
  }
  await logAudit({ userId: session.userId, entityType: "organization_tax_rate", entityId: created.id, action: "create", after: created as never });

  revalidatePath(editPath(organizationId));
  back(organizationId, "notice", `Ставка «${TAX_KIND_LABELS[value.taxKind]}» добавлена`);
}

export async function updateTaxRateAction(organizationId: string, id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const before = await prisma.organizationTaxRate.findFirst({ where: { id, organizationId } });
  if (!before) back(organizationId, "error", "Ставка не найдена — возможно, её уже удалили");
  const result = readForm(formData);
  if ("error" in result) back(organizationId, "error", result.error, id);
  const value = (result as Extract<typeof result, { value: unknown }>).value;

  let updated;
  try {
    updated = await prisma.organizationTaxRate.update({ where: { id }, data: { ...value, ratePct: value.ratePct.toFixed(3) } });
  } catch (error) {
    if (isUniqueViolation(error)) back(organizationId, "error", DUPLICATE, id);
    throw error;
  }
  await logAudit({
    userId: session.userId,
    entityType: "organization_tax_rate",
    entityId: id,
    action: "update",
    before: before as never,
    after: updated as never,
  });

  revalidatePath(editPath(organizationId));
  back(organizationId, "notice", "Ставка изменена");
}

export async function removeTaxRateAction(organizationId: string, id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const rate = await prisma.organizationTaxRate.findFirst({ where: { id, organizationId } });
  if (rate) {
    await prisma.organizationTaxRate.delete({ where: { id } });
    await logAudit({ userId: session.userId, entityType: "organization_tax_rate", entityId: id, action: "delete", before: rate as never });
  }
  revalidatePath(editPath(organizationId));
  back(organizationId, "notice", "Ставка удалена");
}

/** Стандартные ставки выбранной системы налогообложения — только по налогам, у которых ещё нет ни одной ставки. */
export async function fillStandardTaxRatesAction(organizationId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { taxSystem: true } });
  if (!organization || !isTaxSystem(organization.taxSystem)) back(organizationId, "error", "Сначала выберите и сохраните систему налогообложения");

  const date = String(formData.get("validFrom") ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!date) back(organizationId, "error", "Укажите дату, с которой действуют ставки");
  const validFrom = new Date(Date.UTC(Number(date![1]), Number(date![2]) - 1, Number(date![3])));

  const existing = await prisma.organizationTaxRate.findMany({ where: { organizationId } });
  const missing = missingStandardRates(organization!.taxSystem as Parameters<typeof missingStandardRates>[0], existing);
  if (missing.length === 0) back(organizationId, "notice", "Ставки по налогам этой системы уже заведены — меняйте их в таблице");

  await prisma.organizationTaxRate.createMany({
    data: missing.map((m) => ({ organizationId, taxKind: m.kind, ratePct: m.ratePct.toFixed(3), validFrom, comment: "стандартная ставка" })),
  });
  await logAudit({
    userId: session.userId,
    entityType: "organization",
    entityId: organizationId,
    action: "fill_standard_tax_rates",
    after: { validFrom: validFrom.toISOString().slice(0, 10), rates: missing } as never,
  });

  revalidatePath(editPath(organizationId));
  back(organizationId, "notice", `Добавлено: ${missing.map((m) => `${TAX_KIND_LABELS[m.kind as TaxKind]} ${m.ratePct}%`).join(", ")}`);
}
