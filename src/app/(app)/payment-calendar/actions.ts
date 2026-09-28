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

/** Перенос платежа в календаре (перетаскивание или выбор даты): заявка, часть графика или документ. */
export async function moveCalendarItemAction(kind: PlanItemKind, id: string, dueDate: string): Promise<PlanResult> {
  const session = await requireSession();
  if (kind === "part") return reschedulePart(session, id, dueDate, null);
  if (kind === "document") return rescheduleDocument(session, id, dueDate, null);
  return rescheduleRequest(session, id, dueDate, null);
}

/** Счёт оплаты платежа из календаря; пустая строка снимает счёт. */
export async function assignCalendarAccountAction(kind: PlanItemKind, id: string, accountKey: string): Promise<PlanResult> {
  const session = await requireSession();
  return assignPaymentAccount(session, kind, id, accountKey);
}
