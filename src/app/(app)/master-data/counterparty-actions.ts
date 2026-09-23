"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { validateBankDetail, validateContact } from "@/lib/counterparties/validation";

function editPath(counterpartyId: string) {
  return `/master-data/counterparties/${counterpartyId}/edit`;
}

export async function addBankDetailAction(counterpartyId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const result = validateBankDetail({
    bankName: String(formData.get("bankName") ?? ""),
    account: String(formData.get("account") ?? ""),
    bik: String(formData.get("bik") ?? ""),
    corrAccount: String(formData.get("corrAccount") ?? ""),
  });
  if ("error" in result) {
    redirect(`${editPath(counterpartyId)}?error=${encodeURIComponent(result.error)}`);
  }

  const created = await prisma.counterpartyBankDetail.create({ data: { counterpartyId, ...result.value } });

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_bank_detail",
    entityId: created.id,
    action: "create",
    after: created as never,
  });

  revalidatePath(editPath(counterpartyId));
  redirect(editPath(counterpartyId));
}

export async function removeBankDetailAction(counterpartyId: string, id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const before = await prisma.counterpartyBankDetail.findFirstOrThrow({ where: { id, counterpartyId } });
  await prisma.counterpartyBankDetail.delete({ where: { id } });

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_bank_detail",
    entityId: id,
    action: "delete",
    before: before as never,
  });

  revalidatePath(editPath(counterpartyId));
}

export async function addContactAction(counterpartyId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const result = validateContact({
    name: String(formData.get("name") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    email: String(formData.get("email") ?? ""),
    position: String(formData.get("position") ?? ""),
  });
  if ("error" in result) {
    redirect(`${editPath(counterpartyId)}?error=${encodeURIComponent(result.error)}`);
  }

  const created = await prisma.counterpartyContact.create({ data: { counterpartyId, ...result.value } });

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_contact",
    entityId: created.id,
    action: "create",
    after: created as never,
  });

  revalidatePath(editPath(counterpartyId));
  redirect(editPath(counterpartyId));
}

export async function removeContactAction(counterpartyId: string, id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);

  const before = await prisma.counterpartyContact.findFirstOrThrow({ where: { id, counterpartyId } });
  await prisma.counterpartyContact.delete({ where: { id } });

  await logAudit({
    userId: session.userId,
    entityType: "counterparty_contact",
    entityId: id,
    action: "delete",
    before: before as never,
  });

  revalidatePath(editPath(counterpartyId));
}
