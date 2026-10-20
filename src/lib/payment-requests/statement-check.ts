/**
 * Сверка списаний по выписке с заявками на оплату — контроль платежей в обход
 * согласования. Списание сопоставляется с заявкой (или частью графика) той же
 * организации, того же контрагента, на ту же сумму в той же валюте со сроком
 * в пределах месяца от даты списания; каждая заявка (часть) — с одним
 * списанием, ближайшим по дате. Итог по каждому списанию:
 *  - без заявки — денег ушло больше, чем согласовано;
 *  - до согласования — заявка ещё не была согласована на дату списания
 *    (на согласовании, на доработке, отклонена, отменена или согласована позже);
 *  - не отмечена — по выписке оплачено, а в заявке оплата не отмечена;
 *  - в порядке — остальные (только счётчик).
 * Чистая функция — проверяется тестами.
 */
export const STATEMENT_MATCH_DAYS = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

export type StatementOutflow = {
  id: string;
  organizationId: string;
  counterpartyId: string;
  amount: { toString(): string };
  currency: string;
  operationDate: Date;
};

export type CheckedRequest = {
  id: string;
  organizationId: string;
  counterpartyId: string | null;
  currency: string;
  status: string;
  /** Когда заявка стала согласованной (последнее «согласовано» последнего круга); null — не согласована. */
  approvedAt: Date | null;
  /** Платёж целиком или части графика: сумма, срок, отмечена ли оплата. */
  slots: Array<{ key: string; amount: { toString(): string }; dueDate: Date; paid: boolean }>;
};

export type StatementMatch<T extends StatementOutflow, R extends CheckedRequest> = { outflow: T; request: R; slotKey: string };

const money = (v: { toString(): string }) => Number(v.toString()).toFixed(2);
/** Дата списания — календарный день; согласование в тот же день (по Москве) или раньше — в срок. */
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const moscowDayKey = (d: Date) => new Date(d.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);

const APPROVED_STATUSES = new Set(["APPROVED", "PAID"]);

export function approvedInTime(request: CheckedRequest, outflow: StatementOutflow): boolean {
  if (!APPROVED_STATUSES.has(request.status) || !request.approvedAt) return false;
  return moscowDayKey(request.approvedAt) <= dayKey(outflow.operationDate);
}

export function checkStatement<T extends StatementOutflow, R extends CheckedRequest>(outflows: T[], requests: R[]) {
  const candidates: Array<{ outflow: T; request: R; slotKey: string; distance: number; approved: boolean }> = [];
  for (const outflow of outflows) {
    for (const request of requests) {
      if (request.organizationId !== outflow.organizationId || request.counterpartyId !== outflow.counterpartyId) continue;
      if (request.currency !== outflow.currency) continue;
      for (const slot of request.slots) {
        if (money(slot.amount) !== money(outflow.amount)) continue;
        const distance = Math.abs(slot.dueDate.getTime() - outflow.operationDate.getTime());
        if (distance > STATEMENT_MATCH_DAYS * DAY_MS) continue;
        candidates.push({ outflow, request, slotKey: `${request.id}:${slot.key}`, distance, approved: APPROVED_STATUSES.has(request.status) });
      }
    }
  }
  // Approved requests first, then the nearest due date: an approved payment is the likelier explanation.
  candidates.sort((a, b) => Number(b.approved) - Number(a.approved) || a.distance - b.distance);
  const usedOutflows = new Set<string>();
  const usedSlots = new Set<string>();
  const matches: StatementMatch<T, R>[] = [];
  for (const c of candidates) {
    if (usedOutflows.has(c.outflow.id) || usedSlots.has(c.slotKey)) continue;
    usedOutflows.add(c.outflow.id);
    usedSlots.add(c.slotKey);
    matches.push({ outflow: c.outflow, request: c.request, slotKey: c.slotKey });
  }

  const withoutRequest = outflows.filter((o) => !usedOutflows.has(o.id));
  const beforeApproval: StatementMatch<T, R>[] = [];
  const notMarked: StatementMatch<T, R>[] = [];
  let inOrder = 0;
  for (const m of matches) {
    const slot = m.request.slots.find((s) => `${m.request.id}:${s.key}` === m.slotKey)!;
    if (!approvedInTime(m.request, m.outflow)) beforeApproval.push(m);
    else if (!slot.paid) notMarked.push(m);
    else inOrder++;
  }
  const byDate = (a: StatementMatch<T, R>, b: StatementMatch<T, R>) => a.outflow.operationDate.getTime() - b.outflow.operationDate.getTime();
  return {
    withoutRequest: withoutRequest.sort((a, b) => a.operationDate.getTime() - b.operationDate.getTime()),
    beforeApproval: beforeApproval.sort(byDate),
    notMarked: notMarked.sort(byDate),
    inOrder,
  };
}

/** Когда заявка стала согласованной: последнее «согласовано» её текущего круга (null — не согласована). */
export function requestApprovedAt(status: string, round: number, decisions: Array<{ decision: string; round: number; decidedAt: Date }>): Date | null {
  if (!APPROVED_STATUSES.has(status)) return null;
  const times = decisions.filter((d) => d.decision === "approved" && d.round === round).map((d) => d.decidedAt.getTime());
  return times.length > 0 ? new Date(Math.max(...times)) : null;
}
