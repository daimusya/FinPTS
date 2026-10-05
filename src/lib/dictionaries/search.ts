import { textSearchWhere } from "@/lib/text-search";

/**
 * Поиск в списке справочника: запрос ищется без учёта регистра в каждой
 * текстовой колонке (название, ИНН, номер, код…); слова запроса — все
 * обязательны, каждое в любой из колонок («ромашка 7701» найдёт ООО «Ромашка»
 * с ИНН 7701…). Пустой запрос — без условия.
 */
export function dictionarySearchWhere(textColumns: string[], query: string | undefined): Record<string, unknown> {
  return textSearchWhere(textColumns, query);
}
