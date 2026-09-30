import { revalidatePath } from "next/cache";
import { PaymentRequestStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasPermission, type SessionPayload } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { formatMoneyIn } from "@/lib/currency";
import { compareDueTime, localDateKey, parseAccountKey, parseDueTime, parseRescheduleDate, requestPlacement, showDueDate } from "@/lib/payment-calendar";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payment-requests/labels";
import { scheduleSummary, validateSchedule, type ScheduleRowInput } from "@/lib/payment-requests/parts";

/**
 * Планирование платежей: сроки и счета оплаты заявок, их частей и документов
 * начислений, график оплаты частями. Вызывается со страниц заявки и документа
 * и из платёжного календаря — правила одни и те же.
 */
export type PlanResult = { ok: true; message: string } | { ok: false; error: string };

type Db = Prisma.TransactionClient;

const fail = (error: string): PlanResult => ({ ok: false, error });

/**
 * Новый срок из формы: дата и время. Время не передано (перетаскивание в
 * календаре) — остаётся прежнее; передано пустым — «в течение дня».
 */
function parseNewDue(dateRaw: unknown, timeRaw: unknown, currentTime: string | null) {
  const parsed = parseRescheduleDate(dateRaw, localDateKey());
  if ("error" in parsed) return parsed;
  if (timeRaw === undefined) return { ...parsed, time: currentTime };
  const time = parseDueTime(timeRaw);
  if ("error" in time) return time;
  return { ...parsed, time: time.time };
}

/** Ближайшая часть: по дате, затем по времени (без времени — после частей со временем). */
const byDue = (a: { dueDate: Date; dueTime: string | null }, b: { dueDate: Date; dueTime: string | null }) =>
  a.dueDate.getTime() - b.dueDate.getTime() || compareDueTime(a.dueTime, b.dueTime);

/** Сроки и счета заявок: согласующие, казначейство (банк и касса), администратор. */
export function canPlanRequests(session: SessionPayload): boolean {
  return (
    hasPermission(session, PERMISSIONS.ADMIN_FULL) ||
    hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE) ||
    hasPermission(session, PERMISSIONS.CASH_MANAGE)
  );
}

/** Сроки и счета документов начислений: кто ведёт начисления или деньги, администратор. */
export function canPlanDocuments(session: SessionPayload): boolean {
  return (
    hasPermission(session, PERMISSIONS.ADMIN_FULL) ||
    hasPermission(session, PERMISSIONS.ACCRUALS_MANAGE) ||
    hasPermission(session, PERMISSIONS.CASH_MANAGE)
  );
}

function revalidatePlan(paths: string[]) {
  for (const path of ["/payment-calendar", "/payment-requests", "/dashboard", ...paths]) revalidatePath(path);
}

/** Срок заявки с графиком — ближайшая неоплаченная часть (для списка, фильтров и чек-листа закрытия). */
async function syncRequestDueDate(db: Db, requestId: string) {
  const parts = await db.paymentRequestPart.findMany({ where: { paymentRequestId: requestId } });
  if (parts.length === 0) return;
  const unpaid = parts.filter((p) => !p.paidAt).sort(byDue);
  const next = unpaid[0] ?? [...parts].sort(byDue).at(-1)!;
  await db.paymentRequest.update({ where: { id: requestId }, data: { dueDate: next.dueDate, dueTime: next.dueTime } });
}

async function loadMovableRequest(id: string) {
  const request = await prisma.paymentRequest.findUnique({ where: { id }, include: { parts: true } });
  if (!request) return { error: "Заявка не найдена" } as const;
  if (!requestPlacement(request.status, true).movable) {
    return { error: `Заявка в статусе «${PAYMENT_REQUEST_STATUS_LABELS[request.status]}» — план оплаты уже не меняется` } as const;
  }
  return { request } as const;
}

/** Перенос срока заявки, которая платится одной суммой. */
export async function rescheduleRequest(
  session: SessionPayload,
  id: string,
  dateRaw: unknown,
  reasonRaw: unknown,
  timeRaw?: unknown,
): Promise<PlanResult> {
  if (!canPlanRequests(session)) return fail("Переносить срок оплаты могут согласующие заявки и те, кто ведёт банк и кассу");
  const loaded = await loadMovableRequest(id);
  if ("error" in loaded) return fail(loaded.error!);
  const { request } = loaded;
  const parsed = parseNewDue(dateRaw, timeRaw, request.dueTime);
  if ("error" in parsed) return fail(parsed.error);
  if (request.parts.length > 0) return fail("У заявки график оплаты частями — переносите отдельные части");
  if (request.dueDate.toISOString().slice(0, 10) === parsed.key && request.dueTime === parsed.time) return { ok: true, message: "Срок не изменился" };
  const reason = String(reasonRaw ?? "").trim().slice(0, 500) || null;

  // Conditional on the date and status the user saw, so two people moving the same request don't overwrite silently.
  const updated = await prisma.$transaction(async (db) => {
    const moved = await db.paymentRequest.updateMany({
      where: { id, dueDate: request.dueDate, dueTime: request.dueTime, status: request.status },
      data: { dueDate: parsed.date, dueTime: parsed.time },
    });
    if (moved.count === 0) return null;
    await db.paymentRequestReschedule.create({
      data: {
        paymentRequestId: id,
        fromDate: request.dueDate,
        toDate: parsed.date,
        fromTime: request.dueTime,
        toTime: parsed.time,
        changedById: session.userId,
        reason,
      },
    });
    return db.paymentRequest.findUniqueOrThrow({ where: { id } });
  });
  if (!updated) return fail("Заявку только что изменили — обновите страницу и повторите");

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action: "reschedule",
    before: request as never,
    after: { ...updated, rescheduleReason: reason } as never,
  });
  revalidatePlan([`/payment-requests/${id}`]);
  return { ok: true, message: `Срок оплаты перенесён: ${showDueDate(request.dueDate, request.dueTime)} → ${showDueDate(parsed.date, parsed.time)}` };
}

/** Перенос одной части графика оплаты. */
export async function reschedulePart(
  session: SessionPayload,
  partId: string,
  dateRaw: unknown,
  reasonRaw: unknown,
  timeRaw?: unknown,
): Promise<PlanResult> {
  if (!canPlanRequests(session)) return fail("Переносить срок оплаты могут согласующие заявки и те, кто ведёт банк и кассу");
  const part = await prisma.paymentRequestPart.findUnique({ where: { id: partId }, include: { paymentRequest: { select: { currency: true } } } });
  if (!part) return fail("Часть оплаты не найдена");
  if (part.paidAt) return fail("Эта часть уже оплачена");
  const parsed = parseNewDue(dateRaw, timeRaw, part.dueTime);
  if ("error" in parsed) return fail(parsed.error);
  const loaded = await loadMovableRequest(part.paymentRequestId);
  if ("error" in loaded) return fail(loaded.error!);
  if (part.dueDate.toISOString().slice(0, 10) === parsed.key && part.dueTime === parsed.time) return { ok: true, message: "Срок не изменился" };
  const reason = String(reasonRaw ?? "").trim().slice(0, 500) || null;

  const done = await prisma.$transaction(async (db) => {
    const moved = await db.paymentRequestPart.updateMany({
      where: { id: partId, dueDate: part.dueDate, dueTime: part.dueTime, paidAt: null },
      data: { dueDate: parsed.date, dueTime: parsed.time },
    });
    if (moved.count === 0) return false;
    await db.paymentRequestReschedule.create({
      data: {
        paymentRequestId: part.paymentRequestId,
        partId,
        fromDate: part.dueDate,
        toDate: parsed.date,
        fromTime: part.dueTime,
        toTime: parsed.time,
        changedById: session.userId,
        reason,
      },
    });
    await syncRequestDueDate(db, part.paymentRequestId);
    return true;
  });
  if (!done) return fail("Часть только что изменили — обновите страницу и повторите");

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: part.paymentRequestId,
    action: "reschedule_part",
    before: part as never,
    after: { ...part, dueDate: parsed.date, dueTime: parsed.time, rescheduleReason: reason } as never,
  });
  revalidatePlan([`/payment-requests/${part.paymentRequestId}`]);
  return {
    ok: true,
    message: `Часть на ${formatMoneyIn(part.amount.toString(), part.paymentRequest.currency)} перенесена: ${showDueDate(part.dueDate, part.dueTime)} → ${showDueDate(parsed.date, parsed.time)}`,
  };
}

/**
 * Перенос срока оплаты документа начисления. Меняется только срок — не суммы,
 * не проводки, поэтому это можно и у проведённого документа, и в закрытом
 * периоде (срок — договорённость о платеже, а не учётная цифра). Каждый
 * перенос — в истории документа и в журнале аудита.
 */
export async function rescheduleDocument(
  session: SessionPayload,
  id: string,
  dateRaw: unknown,
  reasonRaw: unknown,
  timeRaw?: unknown,
): Promise<PlanResult> {
  if (!canPlanDocuments(session)) return fail("Переносить срок оплаты документа могут те, кто ведёт начисления или деньги");
  const doc = await prisma.accrualDocument.findUnique({ where: { id } });
  if (!doc) return fail("Документ не найден");
  const parsed = parseNewDue(dateRaw, timeRaw, doc.dueTime);
  if ("error" in parsed) return fail(parsed.error);
  if (doc.status === "CANCELLED") return fail("Документ отменён");
  if (doc.paymentStatus === "PAID" || doc.paymentStatus === "OVERPAID") return fail("Документ уже оплачен — срок оплаты не нужен");
  if (doc.dueDate?.toISOString().slice(0, 10) === parsed.key && doc.dueTime === parsed.time) return { ok: true, message: "Срок не изменился" };
  const reason = String(reasonRaw ?? "").trim().slice(0, 500) || null;

  const done = await prisma.$transaction(async (db) => {
    const moved = await db.accrualDocument.updateMany({ where: { id, version: doc.version }, data: { dueDate: parsed.date, dueTime: parsed.time, version: { increment: 1 } } });
    if (moved.count === 0) return false;
    await db.accrualDueDateChange.create({
      data: {
        documentId: id,
        fromDate: doc.dueDate,
        toDate: parsed.date,
        fromTime: doc.dueTime,
        toTime: parsed.time,
        changedById: session.userId,
        reason,
      },
    });
    return true;
  });
  if (!done) return fail("Документ только что изменили — обновите страницу и повторите");

  await logAudit({
    userId: session.userId,
    entityType: "accrual_document",
    entityId: id,
    action: "reschedule_due_date",
    before: { dueDate: doc.dueDate, dueTime: doc.dueTime } as never,
    after: { dueDate: parsed.date, dueTime: parsed.time, reason } as never,
    accrualDocumentId: id,
  });
  revalidatePlan([`/accruals/${id}`, "/accruals", "/reports/debts"]);
  return {
    ok: true,
    message: `Срок оплаты документа № ${doc.number} перенесён: ${doc.dueDate ? showDueDate(doc.dueDate, doc.dueTime) : "не был указан"} → ${showDueDate(parsed.date, parsed.time)}`,
  };
}

export type PlanItemKind = "request" | "part" | "document";

/**
 * Счёт оплаты заявки, отдельной части графика или документа (для прогноза по
 * счетам). Пустое значение снимает счёт (у части — возвращает счёт заявки).
 * Счёт должен принадлежать той же организации.
 */
export async function assignPaymentAccount(session: SessionPayload, kind: PlanItemKind, id: string, keyRaw: unknown): Promise<PlanResult> {
  const clearing = String(keyRaw ?? "") === "";
  const target = clearing ? { bankAccountId: null, cashAccountId: null } : parseAccountKey(keyRaw);
  if (!target) return fail("Выберите счёт или кассу");

  let organizationId: string;
  let requestId: string | null = null;
  if (kind === "document") {
    if (!canPlanDocuments(session)) return fail("Назначать счёт оплаты документа могут те, кто ведёт начисления или деньги");
    const doc = await prisma.accrualDocument.findUnique({ where: { id } });
    if (!doc || doc.status === "CANCELLED") return fail("Документ не найден или отменён");
    organizationId = doc.organizationId;
  } else {
    if (!canPlanRequests(session)) return fail("Назначать счёт оплаты могут согласующие заявки и те, кто ведёт банк и кассу");
    const part = kind === "part" ? await prisma.paymentRequestPart.findUnique({ where: { id } }) : null;
    if (kind === "part" && (!part || part.paidAt)) return fail(part ? "Эта часть уже оплачена" : "Часть оплаты не найдена");
    requestId = kind === "part" ? part!.paymentRequestId : id;
    const request = requestId ? await prisma.paymentRequest.findUnique({ where: { id: requestId } }) : null;
    if (!request) return fail("Заявка не найдена");
    if (!requestPlacement(request.status, true).movable) return fail("Заявка уже оплачена, отклонена или отменена");
    organizationId = request.organizationId;
  }

  let accountName = "не назначен";
  if (target.bankAccountId) {
    const account = await prisma.bankAccount.findUnique({ where: { id: target.bankAccountId } });
    if (!account || account.isArchived) return fail("Счёт не найден или в архиве");
    if (account.organizationId !== organizationId) return fail("Счёт принадлежит другой организации");
    accountName = `${account.bankName} · ${account.accountNumber}`;
  } else if (target.cashAccountId) {
    const account = await prisma.cashAccount.findUnique({ where: { id: target.cashAccountId } });
    if (!account || account.isArchived) return fail("Касса не найдена или в архиве");
    if (account.organizationId !== organizationId) return fail("Касса принадлежит другой организации");
    accountName = account.name;
  }

  if (kind === "document") {
    await prisma.accrualDocument.update({
      where: { id },
      data: { plannedBankAccountId: target.bankAccountId, plannedCashAccountId: target.cashAccountId },
    });
    await logAudit({
      userId: session.userId,
      entityType: "accrual_document",
      entityId: id,
      action: "assign_payment_account",
      after: { plannedBankAccountId: target.bankAccountId, plannedCashAccountId: target.cashAccountId } as never,
      accrualDocumentId: id,
    });
    revalidatePlan([`/accruals/${id}`]);
  } else if (kind === "part") {
    await prisma.paymentRequestPart.update({
      where: { id },
      data: { payBankAccountId: target.bankAccountId, payCashAccountId: target.cashAccountId },
    });
    await logAudit({
      userId: session.userId,
      entityType: "payment_request",
      entityId: requestId!,
      action: "assign_part_payment_account",
      after: { partId: id, payBankAccountId: target.bankAccountId, payCashAccountId: target.cashAccountId } as never,
    });
    revalidatePlan([`/payment-requests/${requestId}`]);
    return { ok: true, message: clearing ? "У части снят свой счёт — действует счёт заявки" : `Счёт оплаты части: ${accountName}` };
  } else {
    await prisma.paymentRequest.update({
      where: { id: requestId! },
      data: { payBankAccountId: target.bankAccountId, payCashAccountId: target.cashAccountId },
    });
    await logAudit({
      userId: session.userId,
      entityType: "payment_request",
      entityId: requestId!,
      action: "assign_payment_account",
      after: { payBankAccountId: target.bankAccountId, payCashAccountId: target.cashAccountId } as never,
    });
    revalidatePlan([`/payment-requests/${requestId}`]);
  }
  return { ok: true, message: clearing ? "Счёт оплаты снят" : `Счёт оплаты: ${accountName}` };
}

/**
 * Сохраняет график оплаты частями. Оплаченные части не трогаются; остальные
 * заменяются строками формы (существующие обновляются по id — с записью
 * переноса, если сменилась дата; новые создаются; убранные удаляются).
 */
export async function savePaymentSchedule(session: SessionPayload, requestId: string, rows: ScheduleRowInput[]): Promise<PlanResult> {
  if (!canPlanRequests(session)) return fail("Менять график оплаты могут согласующие заявки и те, кто ведёт банк и кассу");
  const loaded = await loadMovableRequest(requestId);
  if ("error" in loaded) return fail(loaded.error!);
  const { request } = loaded;
  const paid = request.parts.filter((p) => p.paidAt);
  const unpaid = request.parts.filter((p) => !p.paidAt);
  const checked = validateSchedule({ requestAmount: request.amount, paidAmounts: paid.map((p) => p.amount), rows, todayKey: localDateKey() });
  if ("error" in checked) return fail(checked.error);
  const unpaidIds = new Set(unpaid.map((p) => p.id));
  if (checked.rows.some((r) => r.id && !unpaidIds.has(r.id))) return fail("График изменился — обновите страницу и повторите");

  await prisma.$transaction(async (db) => {
    const keep = new Set(checked.rows.filter((r) => r.id).map((r) => r.id!));
    await db.paymentRequestPart.deleteMany({ where: { paymentRequestId: requestId, paidAt: null, id: { notIn: [...keep] } } });
    const startOrder = paid.length;
    for (const [i, row] of checked.rows.entries()) {
      if (row.id) {
        const before = unpaid.find((p) => p.id === row.id)!;
        await db.paymentRequestPart.update({
          where: { id: row.id },
          data: { dueDate: row.dueDate, dueTime: row.dueTime, amount: row.amount, sortOrder: startOrder + i + 1 },
        });
        if (before.dueDate.getTime() !== row.dueDate.getTime() || before.dueTime !== row.dueTime) {
          await db.paymentRequestReschedule.create({
            data: {
              paymentRequestId: requestId,
              partId: row.id,
              fromDate: before.dueDate,
              toDate: row.dueDate,
              fromTime: before.dueTime,
              toTime: row.dueTime,
              changedById: session.userId,
              reason: "Правка графика оплаты",
            },
          });
        }
      } else {
        await db.paymentRequestPart.create({
          data: { paymentRequestId: requestId, dueDate: row.dueDate, dueTime: row.dueTime, amount: row.amount, sortOrder: startOrder + i + 1 },
        });
      }
    }
    await syncRequestDueDate(db, requestId);
  });

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: requestId,
    action: request.parts.length > 0 ? "update_schedule" : "create_schedule",
    before: { parts: request.parts } as never,
    after: { parts: checked.rows } as never,
  });
  revalidatePlan([`/payment-requests/${requestId}`]);
  return { ok: true, message: `График оплаты сохранён: ${checked.rows.length + paid.length} ч.` };
}

/** Объединение графика обратно в один платёж — только пока ни одна часть не оплачена. */
export async function removePaymentSchedule(session: SessionPayload, requestId: string): Promise<PlanResult> {
  if (!canPlanRequests(session)) return fail("Менять график оплаты могут согласующие заявки и те, кто ведёт банк и кассу");
  const loaded = await loadMovableRequest(requestId);
  if ("error" in loaded) return fail(loaded.error!);
  const { request } = loaded;
  if (request.parts.length === 0) return { ok: true, message: "Графика не было" };
  if (request.parts.some((p) => p.paidAt)) return fail("Часть уже оплачена — объединить график нельзя, можно только изменить неоплаченные части");
  const first = [...request.parts].sort(byDue)[0];
  await prisma.$transaction([
    prisma.paymentRequestPart.deleteMany({ where: { paymentRequestId: requestId } }),
    prisma.paymentRequest.update({ where: { id: requestId }, data: { dueDate: first.dueDate, dueTime: first.dueTime } }),
  ]);
  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: requestId,
    action: "remove_schedule",
    before: { parts: request.parts } as never,
  });
  revalidatePlan([`/payment-requests/${requestId}`]);
  return { ok: true, message: `График объединён: одна оплата ${showDueDate(first.dueDate, first.dueTime)}` };
}

/**
 * Отметка об оплате части. Только у согласованной заявки и для тех, кто ведёт
 * деньги. Последняя оплаченная часть переводит заявку в «Оплачена».
 */
export async function markPartPaid(session: SessionPayload, partId: string): Promise<PlanResult> {
  if (!hasPermission(session, PERMISSIONS.CASH_MANAGE) && !hasPermission(session, PERMISSIONS.ADMIN_FULL)) {
    return fail("Отмечать оплату могут те, кто ведёт банк и кассу");
  }
  const part = await prisma.paymentRequestPart.findUnique({ where: { id: partId }, include: { paymentRequest: true } });
  if (!part) return fail("Часть оплаты не найдена");
  if (part.paymentRequest.status !== PaymentRequestStatus.APPROVED) return fail("Оплачивать можно только согласованную заявку");

  const result = await prisma.$transaction(async (db) => {
    const marked = await db.paymentRequestPart.updateMany({ where: { id: partId, paidAt: null }, data: { paidAt: new Date(), paidById: session.userId } });
    if (marked.count === 0) return null;
    const parts = await db.paymentRequestPart.findMany({ where: { paymentRequestId: part.paymentRequestId } });
    const summary = scheduleSummary(parts);
    if (summary.allPaid) {
      await db.paymentRequest.update({ where: { id: part.paymentRequestId }, data: { status: PaymentRequestStatus.PAID } });
    } else {
      await syncRequestDueDate(db, part.paymentRequestId);
    }
    return summary;
  });
  if (!result) return fail("Эта часть уже оплачена");

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: part.paymentRequestId,
    action: result.allPaid ? "mark_part_paid_final" : "mark_part_paid",
    after: { partId, amount: part.amount, dueDate: part.dueDate, paidCount: result.paidCount, total: result.total } as never,
  });
  revalidatePlan([`/payment-requests/${part.paymentRequestId}`, "/payment-calendar"]);
  return {
    ok: true,
    message: result.allPaid
      ? `Часть на ${formatMoneyIn(part.amount.toString(), part.paymentRequest.currency)} оплачена — заявка оплачена полностью`
      : `Часть на ${formatMoneyIn(part.amount.toString(), part.paymentRequest.currency)} оплачена (${result.paidCount} из ${result.total}), осталось ${formatMoneyIn(result.remainingAmount, part.paymentRequest.currency)}`,
  };
}

/** При отметке всей заявки оплаченной закрываются и её неоплаченные части. */
export async function markRemainingPartsPaid(db: Db, requestId: string, userId: string) {
  await db.paymentRequestPart.updateMany({ where: { paymentRequestId: requestId, paidAt: null }, data: { paidAt: new Date(), paidById: userId } });
}
