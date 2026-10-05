"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { NOT_VISIBLE, organizationAllowed } from "@/lib/access-guard";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import {
  isTaxSystem,
  missingStandardRates,
  parseTaxRateForm,
  SOLE_PROPRIETOR_KINDS,
  TAX_KIND_LABELS,
  type TaxKind,
  type TaxRateForm,
} from "@/lib/organizations/taxes";
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
    thresholdAmount: String(formData.get("thresholdAmount") ?? ""),
    maxAmount: String(formData.get("maxAmount") ?? ""),
    fixedAmount: String(formData.get("fixedAmount") ?? ""),
  });
}

/** Поля записи в БД: суммы — строками с копейками. */
function dbData(value: TaxRateForm) {
  const money = (d: { toFixed(n: number): string } | null) => (d === null ? null : d.toFixed(2));
  return {
    taxKind: value.taxKind,
    ratePct: value.ratePct.toFixed(3),
    validFrom: value.validFrom,
    comment: value.comment,
    thresholdAmount: money(value.thresholdAmount),
    maxAmount: money(value.maxAmount),
    fixedAmount: money(value.fixedAmount),
  };
}

/** Взносы ИП за себя — только у ИП. */
async function soleProprietorProblem(organizationId: string, kind: TaxKind): Promise<string | null> {
  if (!SOLE_PROPRIETOR_KINDS.has(kind)) return null;
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { type: true } });
  return organization?.type === "SOLE_PROPRIETOR" ? null : "Взносы ИП за себя бывают только у ИП — в карточке тип «Индивидуальный предприниматель»";
}

const DUPLICATE = "У этого налога уже есть ставка с такой даты — измените её или выберите другую дату";

export async function addTaxRateAction(organizationId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  if (!(await organizationAllowed(session, organizationId))) throw new Error(NOT_VISIBLE);
  const result = readForm(formData);
  if ("error" in result) back(organizationId, "error", result.error);
  const value = (result as Extract<typeof result, { value: unknown }>).value;
  const problem = await soleProprietorProblem(organizationId, value.taxKind);
  if (problem) back(organizationId, "error", problem);

  let created;
  try {
    created = await prisma.organizationTaxRate.create({ data: { organizationId, ...dbData(value) } });
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
  if (!(await organizationAllowed(session, organizationId))) throw new Error(NOT_VISIBLE);
  const before = await prisma.organizationTaxRate.findFirst({ where: { id, organizationId } });
  if (!before) back(organizationId, "error", "Ставка не найдена — возможно, её уже удалили");
  const result = readForm(formData);
  if ("error" in result) back(organizationId, "error", result.error, id);
  const value = (result as Extract<typeof result, { value: unknown }>).value;
  const problem = await soleProprietorProblem(organizationId, value.taxKind);
  if (problem) back(organizationId, "error", problem, id);

  let updated;
  try {
    updated = await prisma.organizationTaxRate.update({ where: { id }, data: dbData(value) });
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
  if (!(await organizationAllowed(session, organizationId))) throw new Error(NOT_VISIBLE);
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
  if (!(await organizationAllowed(session, organizationId))) throw new Error(NOT_VISIBLE);
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { taxSystem: true, type: true } });
  if (!organization || !isTaxSystem(organization.taxSystem)) back(organizationId, "error", "Сначала выберите и сохраните систему налогообложения");

  const date = String(formData.get("validFrom") ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!date) back(organizationId, "error", "Укажите дату, с которой действуют ставки");
  const validFrom = new Date(Date.UTC(Number(date![1]), Number(date![2]) - 1, Number(date![3])));

  const existing = await prisma.organizationTaxRate.findMany({ where: { organizationId } });
  const missing = missingStandardRates(
    organization!.taxSystem as Parameters<typeof missingStandardRates>[0],
    existing,
    organization!.type,
    validFrom.getUTCFullYear(),
  );
  if (missing.length === 0) back(organizationId, "notice", "Ставки по налогам этой системы уже заведены — меняйте их в таблице");

  await prisma.organizationTaxRate.createMany({
    data: missing.map((m) => ({
      organizationId,
      taxKind: m.kind,
      ratePct: m.ratePct.toFixed(3),
      thresholdAmount: m.thresholdAmount?.toFixed(2) ?? null,
      maxAmount: m.maxAmount?.toFixed(2) ?? null,
      fixedAmount: m.fixedAmount?.toFixed(2) ?? null,
      validFrom,
      comment: "стандартная ставка",
    })),
  });
  await logAudit({
    userId: session.userId,
    entityType: "organization",
    entityId: organizationId,
    action: "fill_standard_tax_rates",
    after: { validFrom: validFrom.toISOString().slice(0, 10), rates: missing } as never,
  });

  revalidatePath(editPath(organizationId));
  back(organizationId, "notice", `Добавлено: ${missing.map((m) => TAX_KIND_LABELS[m.kind]).join("; ")}`);
}
