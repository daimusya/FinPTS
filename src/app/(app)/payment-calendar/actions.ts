"use server";

import { requireSession } from "@/lib/session";
import {
  assignPaymentAccount,
  reschedulePart,
  rescheduleDocument,
  rescheduleRequest,
  type PlanItemKind,
  type PlanResult,
} from "@/lib/payment-plan/service";

/**
 * Перенос платежа в календаре: заявка, часть графика или документ.
 * Перетаскивание передаёт только дату — время остаётся прежним; выбор даты и
 * времени передаёт и время (пустое — «в течение дня»).
 */
export async function moveCalendarItemAction(kind: PlanItemKind, id: string, dueDate: string, dueTime?: string): Promise<PlanResult> {
  const session = await requireSession();
  if (kind === "part") return reschedulePart(session, id, dueDate, null, dueTime);
  if (kind === "document") return rescheduleDocument(session, id, dueDate, null, dueTime);
  return rescheduleRequest(session, id, dueDate, null, dueTime);
}

/** Счёт оплаты платежа из календаря; пустая строка снимает счёт. */
export async function assignCalendarAccountAction(kind: PlanItemKind, id: string, accountKey: string): Promise<PlanResult> {
  const session = await requireSession();
  return assignPaymentAccount(session, kind, id, accountKey);
}
