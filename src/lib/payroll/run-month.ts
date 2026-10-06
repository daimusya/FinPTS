/**
 * Рабочий месяц расчёта зарплаты: аванс (выплата 25-го) и разовые выплаты —
 * за свой месяц, окончательный расчёт (выплата 10-го) — за предыдущий.
 * Чистые функции — проверяются тестами.
 */
export function payrollWorkMonth(kind: string, payoutDate: Date): { year: number; month: number; start: Date; end: Date } {
  const shift = kind === "FINAL" ? -1 : 0;
  const index = payoutDate.getUTCFullYear() * 12 + payoutDate.getUTCMonth() + shift;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return { year, month, start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 0)) };
}

/**
 * Кто участвует в расчёте: работающие и уволенные не раньше даты since.
 * Окончательный расчёт — since = начало рабочего месяца: уволенным в этом
 * месяце положены деньги за отработанные дни (расчёт за сентябрь делается
 * 10 октября, когда уволенный 4 сентября уже «Уволен»; выплаченное им при
 * увольнении вычитается). Аванс — since = дата выплаты: уволенный до неё
 * аванс уже не получает.
 */
export function payrollEmployeeWhere(organizationId: string, since: Date) {
  return {
    organizationId,
    OR: [{ status: "ACTIVE" as const }, { terminationDate: { gte: since } }],
  };
}

/** С какой даты уволенные ещё участвуют в расчёте этого вида. */
export function payrollEmployeesSince(kind: string, payoutDate: Date): Date {
  return kind === "ADVANCE" ? payoutDate : payrollWorkMonth(kind, payoutDate).start;
}
