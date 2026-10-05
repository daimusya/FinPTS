/**
 * Дата из параметра адреса (фильтры «с/по»): только ГГГГ-ММ-ДД и настоящая
 * календарная дата; иначе null — фильтр не применяется, а не роняет страницу.
 */
export function parseDateParam(raw: string | undefined | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : date;
}
