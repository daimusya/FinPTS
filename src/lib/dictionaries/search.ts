/**
 * Поиск в списке справочника: запрос ищется без учёта регистра в каждой
 * текстовой колонке (название, ИНН, номер, код…); слова запроса — все
 * обязательны, каждое в любой из колонок («ромашка 7701» найдёт ООО «Ромашка»
 * с ИНН 7701…). Пустой запрос — без условия.
 */
export function dictionarySearchWhere(textColumns: string[], query: string | undefined): Record<string, unknown> {
  const words = (query ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0 || textColumns.length === 0) return {};
  const perWord = words.map((word) => ({ OR: textColumns.map((column) => ({ [column]: { contains: word, mode: "insensitive" } })) }));
  return perWord.length === 1 ? perWord[0] : { AND: perWord };
}
