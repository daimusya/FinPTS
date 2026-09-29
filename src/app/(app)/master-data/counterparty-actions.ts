"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { nextPrimaryAfterRemoval, validateBankDetail, validateContact } from "@/lib/counterparties/validation";

function editPath(counterpartyId: string) {
  return `/master-data/counterparties/${counterpartyId}/edit`;
}

/** Back to the counterparty card, to the block that was changed, with a message shown inside that block. */
function back(counterpartyId: string, block: "bank" | "contact", kind: "error" | "notice", message: string, keepEditing?: string): never {
  const edit = keepEditing ? `&${block === "bank" ? "editBank" : "editContact"}=${encodeURIComponent(keepEditing)}` : "";
  redirect(`${editPath(counterpartyId)}?${block}${kind === "error" ? "Error" : "Notice"}=${encodeURIComponent(message)}${edit}#${block === "bank" ? "bank-details" : "contacts"}`);
}

function readBankForm(formData: FormData) {
  return validateBankDetail({
    bankName: String(formData.get("bankName") ?? ""),
    account: String(formData.get("account") ?? ""),
    bik: String(formData.get("bik") ?? ""),
    corrAccount: String(formData.get("corrAccount") ?? ""),
  });
}

function readContactForm(formData: FormData) {
  return validateContact({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    position: String(formData.get("position") ?? ""),
  });
}

export async function addBankDetailAction(counterpartyId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const result = readBankForm(formData);
  if ("error" in result) back(counterpartyId, "bank", "error", result.error);
  const value = (result as Extract<typeof result, { value: unknown }>).value;

  const duplicate = await prisma.counterpartyBankDetail.findFirst({ where: { counterpartyId, account: value.account, bik: value.bik } });
  if (duplicate) back(counterpartyId, "bank", "error", "Такой счёт у контрагента уже есть");

  // The first account is primary automatically; a new one becomes primary only when asked.
  const existingCount = await prisma.counterpartyBankDetail.count({ where: { counterpartyId } });
  const isPrimary = existingCount === 0 || formData.get("isPrimary") === "on";
  const created = await prisma.$transaction(async (db) => {
    if (isPrimary) await db.counterpartyBankDetail.updateMany({ where: { counterpartyId, isPrimary: true }, data: { isPrimary: false } });
    return db.counterpartyBankDetail.create({ data: { counterpartyId, ...value, isPrimary } });
  });

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_bank_detail",
    entityId: created.id,
    action: "create",
    after: created as never,
  });

  revalidatePath(editPath(counterpartyId));
  back(counterpartyId, "bank", "notice", isPrimary ? "Счёт добавлен и отмечен основным" : "Счёт добавлен");
}

export async function updateBankDetailAction(counterpartyId: string, id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const before = await prisma.counterpartyBankDetail.findFirst({ where: { id, counterpartyId } });
  if (!before) back(counterpartyId, "bank", "error", "Счёт не найден — возможно, его уже удалили");
  const result = readBankForm(formData);
  if ("error" in result) back(counterpartyId, "bank", "error", result.error, id);
  const value = (result as Extract<typeof result, { value: unknown }>).value;

  const duplicate = await prisma.counterpartyBankDetail.findFirst({
    where: { counterpartyId, account: value.account, bik: value.bik, id: { not: id } },
  });
  if (duplicate) back(counterpartyId, "bank", "error", "Такой счёт у контрагента уже есть", id);

  const updated = await prisma.counterpartyBankDetail.update({ where: { id }, data: value });
  await logAudit({
    userId: session.userId,
    entityType: "counterparty_bank_detail",
    entityId: id,
    action: "update",
    before: before as never,
    after: updated as never,
  });

  revalidatePath(editPath(counterpartyId));
  back(counterpartyId, "bank", "notice", "Реквизиты сохранены");
}

export async function setPrimaryBankDetailAction(counterpartyId: string, id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const target = await prisma.counterpartyBankDetail.findFirst({ where: { id, counterpartyId } });
  if (!target) back(counterpartyId, "bank", "error", "Счёт не найден — возможно, его уже удалили");
  const previous = await prisma.counterpartyBankDetail.findFirst({ where: { counterpartyId, isPrimary: true } });

  await prisma.$transaction([
    prisma.counterpartyBankDetail.updateMany({ where: { counterpartyId, isPrimary: true, id: { not: id } }, data: { isPrimary: false } }),
    prisma.counterpartyBankDetail.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  await logAudit({
    userId: session.userId,
    entityType: "counterparty_bank_detail",
    entityId: id,
    action: "set_primary",
    before: { primaryId: previous?.id ?? null } as never,
    after: { primaryId: id } as never,
  });

  revalidatePath(editPath(counterpartyId));
  back(counterpartyId, "bank", "notice", `Основной счёт: ${target!.bankName} · ${target!.account}`);
}

export async function removeBankDetailAction(counterpartyId: string, id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const all = await prisma.counterpartyBankDetail.findMany({ where: { counterpartyId } });
  const before = all.find((d) => d.id === id);
  if (!before) back(counterpartyId, "bank", "error", "Счёт не найден — возможно, его уже удалили");
  // Removing the primary account passes the mark to the oldest remaining one.
  const nextPrimary = nextPrimaryAfterRemoval(all, id);
  await prisma.$transaction([
    prisma.counterpartyBankDetail.delete({ where: { id } }),
    ...(nextPrimary ? [prisma.counterpartyBankDetail.update({ where: { id: nextPrimary }, data: { isPrimary: true } })] : []),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_bank_detail",
    entityId: id,
    action: "delete",
    before: before as never,
    after: nextPrimary ? ({ newPrimaryId: nextPrimary } as never) : undefined,
  });

  revalidatePath(editPath(counterpartyId));
  const heir = nextPrimary ? all.find((d) => d.id === nextPrimary) : null;
  back(counterpartyId, "bank", "notice", heir ? `Счёт удалён. Основным стал ${heir.bankName} · ${heir.account}` : "Счёт удалён");
}

export async function addContactAction(counterpartyId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const result = readContactForm(formData);
  if ("error" in result) back(counterpartyId, "contact", "error", result.error);

  // The first contact is primary automatically; a new one becomes primary only when asked.
  const existingCount = await prisma.counterpartyContact.count({ where: { counterpartyId } });
  const isPrimary = existingCount === 0 || formData.get("isPrimary") === "on";
  const created = await prisma.$transaction(async (db) => {
    if (isPrimary) await db.counterpartyContact.updateMany({ where: { counterpartyId, isPrimary: true }, data: { isPrimary: false } });
    return db.counterpartyContact.create({
      data: { counterpartyId, ...(result as Extract<typeof result, { value: unknown }>).value, isPrimary },
    });
  });

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_contact",
    entityId: created.id,
    action: "create",
    after: created as never,
  });

  revalidatePath(editPath(counterpartyId));
  back(counterpartyId, "contact", "notice", isPrimary ? "Контакт добавлен и отмечен основным" : "Контакт добавлен");
}

export async function updateContactAction(counterpartyId: string, id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const before = await prisma.counterpartyContact.findFirst({ where: { id, counterpartyId } });
  if (!before) back(counterpartyId, "contact", "error", "Контакт не найден — возможно, его уже удалили");
  const result = readContactForm(formData);
  if ("error" in result) back(counterpartyId, "contact", "error", result.error, id);

  const updated = await prisma.counterpartyContact.update({
    where: { id },
    data: (result as Extract<typeof result, { value: unknown }>).value,
  });
  await logAudit({
    userId: session.userId,
    entityType: "counterparty_contact",
    entityId: id,
    action: "update",
    before: before as never,
    after: updated as never,
  });

  revalidatePath(editPath(counterpartyId));
  back(counterpartyId, "contact", "notice", "Контакт сохранён");
}

export async function setPrimaryContactAction(counterpartyId: string, id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const target = await prisma.counterpartyContact.findFirst({ where: { id, counterpartyId } });
  if (!target) back(counterpartyId, "contact", "error", "Контакт не найден — возможно, его уже удалили");
  const previous = await prisma.counterpartyContact.findFirst({ where: { counterpartyId, isPrimary: true } });

  await prisma.$transaction([
    prisma.counterpartyContact.updateMany({ where: { counterpartyId, isPrimary: true, id: { not: id } }, data: { isPrimary: false } }),
    prisma.counterpartyContact.update({ where: { id }, data: { isPrimary: true } }),
  ]);
  await logAudit({
    userId: session.userId,
    entityType: "counterparty_contact",
    entityId: id,
    action: "set_primary",
    before: { primaryId: previous?.id ?? null } as never,
    after: { primaryId: id } as never,
  });

  revalidatePath(editPath(counterpartyId));
  back(counterpartyId, "contact", "notice", `Основной контакт: ${target!.name}`);
}

export async function removeContactAction(counterpartyId: string, id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const all = await prisma.counterpartyContact.findMany({ where: { counterpartyId } });
  const before = all.find((c) => c.id === id);
  if (!before) back(counterpartyId, "contact", "error", "Контакт не найден — возможно, его уже удалили");
  // Removing the primary contact passes the mark to the oldest remaining one.
  const nextPrimary = nextPrimaryAfterRemoval(all, id);
  await prisma.$transaction([
    prisma.counterpartyContact.delete({ where: { id } }),
    ...(nextPrimary ? [prisma.counterpartyContact.update({ where: { id: nextPrimary }, data: { isPrimary: true } })] : []),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_contact",
    entityId: id,
    action: "delete",
    before: before as never,
    after: nextPrimary ? ({ newPrimaryId: nextPrimary } as never) : undefined,
  });

  revalidatePath(editPath(counterpartyId));
  const heir = nextPrimary ? all.find((c) => c.id === nextPrimary) : null;
  back(counterpartyId, "contact", "notice", heir ? `Контакт удалён. Основным стал ${heir.name}` : "Контакт удалён");
}
