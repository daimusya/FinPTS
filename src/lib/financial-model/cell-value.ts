/**
 * Значение ячейки сценария (драйвера): число не меньше нуля, с запятой или
 * точкой, пробелы между разрядами допустимы — «1 500,5». Поле в базе —
 * Decimal(18, 4): до 14 цифр целой части и 4 после запятой. Чистая функция —
 * проверяется тестами.
 */
const MAX_VALUE = 99_999_999_999_999;

export function parseScenarioCell(raw: string): { value: string } | { error: string } {
  const text = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (/^-\d+(\.\d+)?$/.test(text)) return { error: `«${raw.trim()}» — не может быть меньше нуля` };
  if (!/^\d+(\.\d+)?$/.test(text)) return { error: `«${raw.trim()}» — не число` };
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > 4) return { error: `«${raw.trim()}» — не больше 4 знаков после запятой` };
  if (Number(text) > MAX_VALUE || whole.replace(/^0+/, "").length > 14) return { error: `«${raw.trim()}» — слишком большое число` };
  return { value: text };
}

/** Год и месяц из имени ячейки («2027_3»): месяц 1–12, год 2000–2100, иначе null. */
export function parseCellMonth(ym: string): { year: number; month: number } | null {
  const match = /^(\d{4})_(\d{1,2})$/.exec(ym);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12 ? { year, month } : null;
}
