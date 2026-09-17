"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate } from "@/lib/period";
import { recomputeAccrualDocumentStatus } from "@/lib/matching";
import { PERMISSIONS } from "@/lib/permissions";
import { AccrualDocumentStatus } from "@prisma/client";
import type { LineDraft } from "@/components/accrual-lines-editor";

interface DocumentHeaderInput {
  organizationId: string;
  counterpartyId: string;
  contractId: string | null;
  number: string;
  date: Date;
  documentType: string;
  direction: string;
  dueDate: Date | null;
  responsibleId: string | null;
  comment: string | null;
}

function parseHeader(formData: FormData): DocumentHeaderInput {
  const organizationId = String(formData.get("organizationId") ?? "");
  const counterpartyId = String(formData.get("counterpartyId") ?? "");
  const number = String(formData.get("number") ?? "").trim();
  const dateRaw = String(formData.get("date") ?? "");
  const documentType = String(formData.get("documentType") ?? "");
  const direction = String(formData.get("direction") ?? "");

  if (!organizationId || !counterpartyId || !number || !dateRaw || !documentType || !direction) {
    throw new Error("Заполните все обязательные поля документа");
  }

  const contractIdRaw = String(formData.get("contractId") ?? "");
  const dueDateRaw = String(formData.get("dueDate") ?? "");
  const responsibleIdRaw = String(formData.get("responsibleId") ?? "");
  const comment = String(formData.get("comment") ?? "").trim();

  return {
    organizationId,
    counterpartyId,
    contractId: contractIdRaw || null,
    number,
    date: new Date(dateRaw),
    documentType,
    direction,
    dueDate: dueDateRaw ? new Date(dueDateRaw) : null,
    responsibleId: responsibleIdRaw || null,
    comment: comment || null,
  };
}

function parseLines(formData: FormData) {
  const raw = String(formData.get("linesJson") ?? "[]");
  let drafts: LineDraft[];
  try {
    drafts = JSON.parse(raw);
  } catch {
    throw new Error("Некорректные строки документа");
  }

  const lines = drafts
    .filter((l) => l.amount && Number(l.amount) !== 0)
    .map((l) => ({
      departmentId: l.departmentId || null,
      costCenterId: l.costCenterId || null,
      projectId: l.projectId || null,
      productServiceId: l.productServiceId || null,
      pnlArticleId: l.pnlArticleId || null,
      amount: Number(l.amount),
      vatAmount: l.vatAmount ? Number(l.vatAmount) : null,
      description: l.description || null,
    }));

  if (lines.length === 0) {
    throw new Error("Добавьте хотя бы одну строку с суммой");
  }

  return lines;
}

export async function createAccrualDocumentAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.ACCRUALS_MANAGE);

  let header: DocumentHeaderInput;
  let lines: ReturnType<typeof parseLines>;
  try {
    header = parseHeader(formData);
    lines = parseLines(formData);
    await assertPeriodOpenForDate(header.date);
  } catch (error) {
    redirect(`/accruals/new?error=${encodeURIComponent((error as Error).message)}`);
  }

  const created = await prisma.accrualDocument.create({
    data: {
      ...header,
      documentType: header.documentType as never,
      direction: header.direction as never,
      status: AccrualDocumentStatus.DRAFT,
      lines: { create: lines },
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "accrual_document",
    entityId: created.id,
    action: "create",
    after: created as never,
    accrualDocumentId: created.id,
  });

  revalidatePath("/accruals");
  redirect(`/accruals/${created.id}`);
}

export async function updateAccrualDocumentAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.ACCRUALS_MANAGE);

  const existing = await prisma.accrualDocument.findUniqueOrThrow({ where: { id } });
  if (existing.status !== AccrualDocumentStatus.DRAFT) {
    redirect(`/accruals/${id}?error=${encodeURIComponent("Изменять можно только черновик")}`);
  }

  let header: DocumentHeaderInput;
  let lines: ReturnType<typeof parseLines>;
  try {
    header = parseHeader(formData);
    lines = parseLines(formData);
    await assertPeriodOpenForDate(header.date);
  } catch (error) {
    redirect(`/accruals/${id}/edit?error=${encodeURIComponent((error as Error).message)}`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.accrualDocumentLine.deleteMany({ where: { documentId: id } });
    return tx.accrualDocument.update({
      where: { id },
      data: {
        ...header,
        documentType: header.documentType as never,
        direction: header.direction as never,
        lines: { create: lines },
      },
    });
  });

  await recomputeAccrualDocumentStatus(id);

  await logAudit({
    userId: session.userId,
    entityType: "accrual_document",
    entityId: id,
    action: "update",
    before: existing as never,
    after: updated as never,
    accrualDocumentId: id,
  });

  revalidatePath("/accruals");
  revalidatePath(`/accruals/${id}`);
  redirect(`/accruals/${id}`);
}

export async function postAccrualDocumentAction(id: string) {
  const session = await requirePermission(PERMISSIONS.ACCRUALS_MANAGE);

  const existing = await prisma.accrualDocument.findUniqueOrThrow({ where: { id } });
  if (existing.status !== AccrualDocumentStatus.DRAFT) {
    redirect(`/accruals/${id}?error=${encodeURIComponent("Провести можно только черновик")}`);
  }
  try {
    await assertPeriodOpenForDate(existing.date);
  } catch (e) {
    redirect(`/accruals/${id}?error=${encodeURIComponent((e as Error).message)}`);
  }

  const updated = await prisma.accrualDocument.update({
    where: { id },
    data: { status: AccrualDocumentStatus.POSTED },
  });

  await logAudit({
    userId: session.userId,
    entityType: "accrual_document",
    entityId: id,
    action: "post",
    before: existing as never,
    after: updated as never,
    accrualDocumentId: id,
  });

  revalidatePath("/accruals");
  revalidatePath(`/accruals/${id}`);
}

export async function cancelAccrualDocumentAction(id: string) {
  const session = await requirePermission(PERMISSIONS.ACCRUALS_MANAGE);

  const existing = await prisma.accrualDocument.findUniqueOrThrow({
    where: { id },
    include: { allocations: { where: { cancelledAt: null } } },
  });
  if (existing.allocations.length > 0) {
    redirect(
      `/accruals/${id}?error=${encodeURIComponent("Нельзя отменить документ с активными сопоставлениями оплат — сначала отмените сопоставления")}`,
    );
  }
  try {
    await assertPeriodOpenForDate(existing.date);
  } catch (e) {
    redirect(`/accruals/${id}?error=${encodeURIComponent((e as Error).message)}`);
  }

  const updated = await prisma.accrualDocument.update({
    where: { id },
    data: { status: AccrualDocumentStatus.CANCELLED },
  });

  await logAudit({
    userId: session.userId,
    entityType: "accrual_document",
    entityId: id,
    action: "cancel",
    before: existing as never,
    after: updated as never,
    accrualDocumentId: id,
  });

  revalidatePath("/accruals");
  revalidatePath(`/accruals/${id}`);
}
