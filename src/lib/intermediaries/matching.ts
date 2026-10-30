/**
 * Сопоставление поступлений с посредниками (раздел «Комиссии посредников»).
 *
 * Плательщик относится к посреднику, если:
 *  1. его ИНН закреплён за посредником вручную (IntermediaryPayer) — это
 *     решение главнее всего; ИНН, закреплённый «без посредника», исключает
 *     плательщика из расчёта;
 *  2. иначе — по названию: наименование из выписки совпадает с названием
 *     организации из списка посредника без учёта формы (ООО, ИП, «СЗ»…),
 *     кавычек, регистра и опечатки в одну-две буквы. Такие совпадения
 *     показываются «на проверку», пока ИНН не закреплён.
 *
 * Для ИП в списке обычно фамилия и инициалы («ИП Иванов Д.В.»), а в
 * выписке — полное ФИО: совпадают фамилия и первые буквы имени и отчества.
 * «ИНН 763» или три цифры в конце названия («ПСК инн 105») — окончание ИНН,
 * по нему различаются одноимённые организации.
 */

import { stripRequisites } from "@/lib/bank-import/client-bank";

const LATIN_TO_CYRILLIC: Record<string, string> = { A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х", Y: "У" };

const LEGAL_PHRASES = [
  "ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ",
  "НЕПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО",
  "ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО",
  "ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО",
  "ОТКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО",
  "АКЦИОНЕРНОЕ ОБЩЕСТВО",
  "АВТОНОМНАЯ НЕКОММЕРЧЕСКАЯ ОРГАНИЗАЦИЯ",
  "ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ",
  "СПЕЦИАЛИЗИРОВАННЫЙ ЗАСТРОЙЩИК",
  "ФИЛИАЛ",
];
const LEGAL_TOKENS = new Set(["ООО", "АО", "ЗАО", "ПАО", "ОАО", "НАО", "АНО", "ИП", "СЗ"]);

function upper(name: string): string {
  return name
    .toUpperCase()
    .replace(/Ё/g, "Е")
    .replace(/[ABCEHKMOPTXY]/g, (ch) => LATIN_TO_CYRILLIC[ch] ?? ch);
}

export interface ParsedName {
  /** Буквы и цифры названия без формы собственности — ключ для сравнения. */
  key: string;
  /** Слова названия без формы собственности (для ИП — фамилия, имя, отчество или инициалы). */
  words: string[];
  isEntrepreneur: boolean;
  /** Окончание ИНН из названия («ПСК инн 763» → «763»). */
  innSuffix: string | null;
  /** Ключ вместе с тремя цифрами в конце — на случай, если это часть названия, а не ИНН. */
  keyWithDigits: string | null;
}

export function parseName(raw: string): ParsedName {
  let name = upper(stripRequisites(raw));
  // \b в JavaScript знает только латиницу — границы русских слов задаём явно.
  const isEntrepreneur = /^\s*ИП(?![А-ЯA-Z0-9])/.test(name) || name.includes("ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ");
  let innSuffix: string | null = null;
  let keyWithDigits: string | null = null;
  const innMatch = name.match(/(?<![А-ЯA-Z0-9])ИНН\s*(\d{3,12})(?!\d)/);
  if (innMatch) {
    innSuffix = innMatch[1];
    name = name.replace(innMatch[0], " ");
  }
  name = name.replace(/\([^)]*\)/g, " ");
  for (const phrase of LEGAL_PHRASES) name = name.split(phrase).join(" ");
  const words = name
    .split(/[^А-ЯA-Z0-9]+/)
    .filter((w) => w && !LEGAL_TOKENS.has(w));
  if (!innSuffix && words.length > 1 && /^\d{3}$/.test(words[words.length - 1])) {
    keyWithDigits = words.join("");
    innSuffix = words.pop() ?? null;
  }
  return { key: words.join(""), words, isEntrepreneur, innSuffix, keyWithDigits };
}

function levenshtein(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Подходит ли плательщик из выписки к названию из списка посредника. */
export function namesMatch(listName: ParsedName, payer: ParsedName, payerInn: string | null): boolean {
  if (!listName.key || !payer.key) return false;
  if (listName.isEntrepreneur) {
    const individual = payer.isEntrepreneur || (payerInn?.length ?? 0) === 12;
    if (!individual || payer.words[0] !== listName.words[0]) return false;
    // Инициалы из списка («Д», «В» из «Д.В.») — первые буквы имени и отчества плательщика.
    return listName.words.slice(1).every((initial, i) => {
      const word = payer.words[i + 1];
      return !word || word.startsWith(initial.slice(0, 1));
    });
  }
  if (payer.isEntrepreneur) return false;
  if (listName.keyWithDigits && listName.keyWithDigits === payer.key) return true;
  if (listName.innSuffix && !(payerInn ?? "").endsWith(listName.innSuffix)) return false;
  if (listName.key === payer.key) return true;
  // Опечатки в списке («Альернатива», «Девелопменит»): одна буква на коротких названиях, две — на длинных.
  const limit = listName.key.length >= 12 ? 2 : listName.key.length >= 6 ? 1 : 0;
  return limit > 0 && levenshtein(listName.key, payer.key, limit) <= limit;
}

export interface MatcherIntermediary {
  id: string;
  clients: Array<{ id: string; name: string }>;
}

/** ИНН плательщика, закреплённый вручную: за посредником или «без посредника» (intermediaryId null). */
export interface MatcherBinding {
  inn: string;
  intermediaryId: string | null;
}

export type PayerMatch =
  | { kind: "inn"; intermediaryId: string }
  | { kind: "name"; intermediaryId: string; clientName: string }
  | { kind: "ambiguous"; intermediaryIds: string[]; clientNames: string[] }
  | { kind: "excluded" }
  | { kind: "none" };

export interface PayerInput {
  inn: string | null;
  name: string | null;
}

/** Плательщик — это ИНН; без ИНН — наименование. */
export function payerKey(payer: PayerInput): string {
  return payer.inn ?? `name:${(payer.name ?? "").trim().toUpperCase()}`;
}

/**
 * Посредник для каждого плательщика (ключ — payerKey). Наименования одного
 * ИНН сравниваются все: в выписках одна организация бывает записана
 * по-разному («ООО "ИССО"» и «ООО "ИСКУССТВЕННЫЕ СООРУЖЕНИЯ"»), и совпадение
 * любого из них относит к посреднику все её поступления.
 */
export function resolvePayers(intermediaries: MatcherIntermediary[], bindings: MatcherBinding[], payers: PayerInput[]): Map<string, PayerMatch> {
  const byInn = new Map(bindings.map((b) => [b.inn, b.intermediaryId]));
  const clients = intermediaries.flatMap((m) => m.clients.map((c) => ({ intermediaryId: m.id, name: c.name, parsed: parseName(c.name) })));

  const groups = new Map<string, { inn: string | null; names: Set<string> }>();
  for (const payer of payers) {
    const key = payerKey(payer);
    const group = groups.get(key) ?? { inn: payer.inn, names: new Set<string>() };
    if (payer.name) group.names.add(payer.name);
    groups.set(key, group);
  }

  const result = new Map<string, PayerMatch>();
  for (const [key, group] of groups) {
    if (group.inn && byInn.has(group.inn)) {
      const intermediaryId = byInn.get(group.inn);
      result.set(key, intermediaryId ? { kind: "inn", intermediaryId } : { kind: "excluded" });
      continue;
    }
    const found = new Set<(typeof clients)[number]>();
    for (const name of group.names) {
      const parsed = parseName(name);
      for (const client of clients) {
        if (!found.has(client) && namesMatch(client.parsed, parsed, group.inn)) found.add(client);
      }
    }
    const matched = [...found];
    const ids = [...new Set(matched.map((c) => c.intermediaryId))];
    result.set(
      key,
      ids.length === 0
        ? { kind: "none" }
        : ids.length === 1
          ? { kind: "name", intermediaryId: ids[0], clientName: matched[0].name }
          : { kind: "ambiguous", intermediaryIds: ids, clientNames: [...new Set(matched.map((c) => c.name))] },
    );
  }
  return result;
}
