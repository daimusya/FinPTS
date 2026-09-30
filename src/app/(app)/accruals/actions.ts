"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, requireSession } from "@/lib/session";
import { assignPaymentAccount, rescheduleDocument } from "@/lib/payment-plan/service";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate } from "@/lib/period";
import { recomputeAccrualDocumentStatus } from "@/lib/matching";
import { PERMISSIONS } from "@/lib/permissions";
import { AccrualDocumentStatus } from "@prisma/client";
import type { LineDraft } from "@/components/accrual-lines-editor";
import type Decimal from "decimal.js";
import { isForeign, lineAmounts, parseRate } from "@/lib/accruals/currency";
import { normalizeCurrency } from "@/lib/currency";
import { loadRateLookup } from "@/lib/currency-rates";
import { currencyNotAllowed } from "@/lib/foreign-currency";
import { enqueueProjectResultsForDocument } from "@/lib/integrations/project-results";

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
  currency: string;
  exchangeRate: Decimal | null;
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
    currency: normalizeCurrency(formData.get("currency")),
    exchangeRate: null,
  };
}

/**
 * Курс документа в валюте: из формы или курс ЦБ на дату документа (последний
 * установленный не позже неё). Для рублёвого документа — null.
 */
async function resolveDocumentRate(header: DocumentHeaderInput, formData: FormData): Promise<Decimal | null> {
  if (!isForeign(header.currency)) return null;
  const notAllowed = await currencyNotAllowed(header.organizationId, header.currency);
  if (notAllowed) throw new Error(notAllowed);
  const parsed = parseRate(String(formData.get("exchangeRate") ?? ""));
  if ("error" in parsed) throw new Error(parsed.error);
  if (parsed.rate) return parsed.rate;
  const rates = await loadRateLookup();
  const rate = rates.rateOn(header.currency, header.date);
  if (!rate || rates.missingText()) {
    throw new Error(`Нет курса ЦБ ${header.currency} на дату документа — загрузите курсы в справочнике «Курсы валют» или укажите курс вручную`);
  }
  return rate;
}

function parseLines(formData: FormData, rate: Decimal | null) {
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
      // A document in a foreign currency: amounts are entered in the currency, roubles at the document rate.
      ...lineAmounts({ amount: Number(l.amount), vatAmount: l.vatAmount ? Number(l.vatAmount) : null }, rate),
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
    header.exchangeRate = await resolveDocumentRate(header, formData);
    lines = parseLines(formData, header.exchangeRate);
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
    header.exchangeRate = await resolveDocumentRate(header, formData);
    lines = parseLines(formData, header.exchangeRate);
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
  await enqueueProjectResultsForDocument(id);

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
  await enqueueProjectResultsForDocument(id);

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

/** Срок оплаты документа (в т. ч. проведённого): меняется только срок, с причиной и историей. */
export async function rescheduleDocumentAction(id: string, formData: FormData) {
  const session = await requireSession();
  const result = await rescheduleDocument(session, id, formData.get("dueDate"), formData.get("reason"), formData.get("dueTime") ?? "");
  const param = result.ok ? `notice=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent((result as { error: string }).error)}`;
  redirect(`/accruals/${id}?${param}`);
}

/** Плановый счёт оплаты документа — для прогноза по счетам в платёжном календаре. */
export async function assignDocumentAccountAction(id: string, formData: FormData) {
  const session = await requireSession();
  const result = await assignPaymentAccount(session, "document", id, formData.get("payAccount"));
  const param = result.ok ? `notice=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent((result as { error: string }).error)}`;
  redirect(`/accruals/${id}?${param}`);
}
