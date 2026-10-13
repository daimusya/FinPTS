/**
 * Подмена реквизитов получателя между согласованием и оплатой: если основной
 * счёт контрагента изменили (или сделали основным другой) после первого
 * согласования текущего круга, согласующие видели другой счёт — перед оплатой
 * его нужно сверить. Чистая функция — проверяется тестами.
 */
export function payeeChangedSince(
  primaryUpdatedAt: Date | null,
  decisions: Array<{ decision: string; round: number; decidedAt: Date }>,
  round: number,
): Date | null {
  if (!primaryUpdatedAt) return null;
  const approvals = decisions.filter((d) => d.decision === "approved" && d.round === round).map((d) => d.decidedAt.getTime());
  if (approvals.length === 0) return null;
  const firstApproval = new Date(Math.min(...approvals));
  return primaryUpdatedAt > firstApproval ? firstApproval : null;
}
