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
 * Кто участвует в расчёте за месяц: работающие и уволенные в этом месяце
 * или позже — им положены деньги за отработанные дни месяца увольнения
 * (окончательный расчёт за сентябрь делается 10 октября, когда сотрудник,
 * уволенный 4 сентября, уже «Уволен»).
 */
export function payrollEmployeeWhere(organizationId: string, monthStart: Date) {
  return {
    organizationId,
    OR: [{ status: "ACTIVE" as const }, { terminationDate: { gte: monthStart } }],
  };
}
