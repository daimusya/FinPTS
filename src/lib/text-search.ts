/**
 * Поиск в списках: запрос ищется без учёта регистра в перечисленных
 * текстовых полях, в том числе связанных записей («counterparty.inn»);
 * каждое слово запроса должно найтись хотя бы в одном поле («ромашка 7701»).
 * Пустой запрос — без условия.
 */
export function textSearchWhere(paths: string[], query: string | undefined): Record<string, unknown> {
  const words = (query ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0 || paths.length === 0) return {};
  const condition = (path: string, word: string): Record<string, unknown> =>
    path
      .split(".")
      .reverse()
      .reduce<Record<string, unknown>>((inner, key, i) => ({ [key]: i === 0 ? { contains: word, mode: "insensitive" } : inner }), {});
  const perWord = words.map((word) => ({ OR: paths.map((path) => condition(path, word)) }));
  return perWord.length === 1 ? perWord[0] : { AND: perWord };
}
