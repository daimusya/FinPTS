/**
 * Возможный дубль заявки на оплату: та же организация, тот же контрагент, та
 * же сумма в той же валюте и срок оплаты в пределах двух недель от другой
 * живой заявки (на согласовании, согласованной, на доработке или уже
 * оплаченной). Так ловят один счёт, заведённый дважды, — до двойной оплаты.
 * Ежемесячные платежи одной суммой (аренда) разнесены больше чем на две недели
 * и дублем не считаются. Чистая функция — проверяется тестами.
 */
export const DUPLICATE_WINDOW_DAYS = 14;

/** Статусы, в которых заявка может быть (или уже была) оплачена. */
export const DUPLICATE_CANDIDATE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "RETURNED", "PAID"] as const;
/** Статусы, в которых о дубле ещё есть смысл предупреждать: решение или оплата впереди. */
export const DUPLICATE_SUBJECT_STATUSES = ["PENDING_APPROVAL", "APPROVED", "RETURNED"] as const;

export type DuplicateCandidate = {
  id: string;
  organizationId: string;
  counterpartyId: string | null;
  amount: { toString(): string };
  currency: string;
  dueDate: Date;
  status: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function amountKey(amount: { toString(): string }): string {
  const n = Number(amount.toString());
  return Number.isFinite(n) ? n.toFixed(2) : amount.toString();
}

export function isPossibleDuplicate(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (a.id === b.id || !a.counterpartyId) return false;
  if ((DUPLICATE_CANDIDATE_STATUSES as readonly string[]).indexOf(b.status) < 0) return false;
  return (
    a.organizationId === b.organizationId &&
    a.counterpartyId === b.counterpartyId &&
    a.currency === b.currency &&
    amountKey(a.amount) === amountKey(b.amount) &&
    Math.abs(a.dueDate.getTime() - b.dueDate.getTime()) <= DUPLICATE_WINDOW_DAYS * DAY_MS
  );
}

/** Для каждой заявки-«субъекта» — её возможные дубли среди кандидатов (по сроку оплаты). */
export function matchDuplicates<T extends DuplicateCandidate>(subjects: DuplicateCandidate[], candidates: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const s of subjects) {
    if ((DUPLICATE_SUBJECT_STATUSES as readonly string[]).indexOf(s.status) < 0) continue;
    const found = candidates.filter((c) => isPossibleDuplicate(s, c)).sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime());
    if (found.length > 0) result.set(s.id, found);
  }
  return result;
}

/** Границы сроков оплаты, в которых искать дубли для набора заявок. */
export function duplicateSearchRange(subjects: Array<{ dueDate: Date }>): { from: Date; to: Date } | null {
  if (subjects.length === 0) return null;
  const times = subjects.map((s) => s.dueDate.getTime());
  return { from: new Date(Math.min(...times) - DUPLICATE_WINDOW_DAYS * DAY_MS), to: new Date(Math.max(...times) + DUPLICATE_WINDOW_DAYS * DAY_MS) };
}
