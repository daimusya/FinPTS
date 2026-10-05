/**
 * Параметры адреса для фильтров списков. Адрес может быть испорчен (старая
 * или отредактированная ссылка): параметр повторён (?status=A&status=B —
 * приходит массив) или значение не из списка допустимых. Такие значения не
 * должны ронять страницу — берётся первое значение, недопустимое
 * игнорируется.
 */
export function oneParam(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first : undefined;
}

/** Значение из перечня (статус, направление…) или undefined. */
export function enumParam<T extends string>(value: unknown, allowed: Record<string, T> | readonly T[]): T | undefined {
  const raw = oneParam(value);
  const values: readonly string[] = Array.isArray(allowed) ? allowed : Object.values(allowed);
  return raw !== undefined && values.includes(raw) ? (raw as T) : undefined;
}

/** Все параметры страницы — по одной строке на имя (для фильтров и ссылок постраничного просмотра). */
export function singleParams<T extends object>(params: T): { [K in keyof T]: string | undefined } {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key, oneParam(value)])) as { [K in keyof T]: string | undefined };
}
