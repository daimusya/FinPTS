/**
 * Счёт или карта сотрудника для зарплаты: 20 цифр счёта или 16–19 цифр карты
 * (с проверкой контрольной цифры по Луну — опечатка в номере карты отправит
 * зарплату не туда или вернёт её). Пробелы и дефисы при вводе допустимы,
 * хранятся только цифры. Чистые функции — проверяются тестами.
 */
export function parsePayAccount(raw: unknown): { value: string | null } | { error: string } {
  const text = String(raw ?? "").trim();
  if (!text) return { value: null };
  const digits = text.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) return { error: "Счёт или карта для зарплаты: только цифры — 20 цифр счёта или 16–19 цифр карты" };
  if (digits.length === 20) return { value: digits };
  if (digits.length >= 16 && digits.length <= 19) {
    return luhnValid(digits) ? { value: digits } : { error: "Номер карты для зарплаты набран с ошибкой (не сходится контрольная цифра)" };
  }
  return { error: `Счёт или карта для зарплаты: ${digits.length} цифр — нужно 20 цифр счёта или 16–19 цифр карты` };
}

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Для уведомлений — только последние 4 цифры. */
export function maskPayAccount(value: string | null): string {
  if (!value) return "не указан";
  return `${value.length === 20 ? "счёт" : "карта"} …${value.slice(-4)}`;
}
