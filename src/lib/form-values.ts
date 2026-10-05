/**
 * Дата и сумма из формы. Браузер обычно присылает правильный формат, но
 * опечатка в годе при наборе с клавиатуры («0202», «20255») даёт настоящую,
 * но бессмысленную дату — документ уезжает на века и искажает отчёты; а «abc»
 * в сумме не меньше нуля и доходила до базы. Чистые функции — проверяются
 * тестами.
 */
export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;
/** Decimal(18, 2): до 16 цифр в целой части. */
const MAX_AMOUNT = 9_999_999_999_999_999;

/** label — название поля в именительном падеже: «Дата документа». */
export function parseFormDate(raw: unknown, label: string): { date: Date } | { error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { error: `Заполните поле «${label}»` };
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return { error: `${label}: «${text}» — не дата` };
  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return { error: `${label}: ${year} год — похоже на опечатку (допустимо ${MIN_YEAR}–${MAX_YEAR})` };
  return { date };
}

/** Положительная сумма до копеек: «1 234,56» → «1234.56». */
export function parseFormAmount(raw: unknown, label = "Сумма"): { value: string } | { error: string } {
  const text = (typeof raw === "string" ? raw : "").replace(/[\s\u00a0]/g, "").replace(",", ".");
  if (!text) return { error: `${label}: укажите` };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: `${label}: «${String(raw).trim()}» — нужно число, не больше двух знаков после запятой` };
  const value = Number(text);
  if (value <= 0) return { error: `${label} должна быть больше нуля` };
  if (value > MAX_AMOUNT) return { error: `${label} слишком большая` };
  return { value: text.replace(/^0+(?=\d)/, "") };
}


/** Для даты ГГГГ-ММ-ДД, уже проверенной по формату: «202 год — похоже на опечатку…» или null. */
export function yearProblem(key: string): string | null {
  const year = Number(key.slice(0, 4));
  return year < MIN_YEAR || year > MAX_YEAR ? `${year} год — похоже на опечатку (допустимо ${MIN_YEAR}–${MAX_YEAR})` : null;
}
