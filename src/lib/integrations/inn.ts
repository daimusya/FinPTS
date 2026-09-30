/**
 * ИНН: проверка контрольных цифр по алгоритму ФНС. Ловит опечатки ещё до
 * обращения к внешнему сервису. 10 цифр — организация, 12 — ИП или физлицо.
 */
export function validateInn(raw: string): string | null {
  const inn = raw.replace(/\s/g, "");
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return "ИНН — 10 цифр у организации или 12 у ИП";
  const d = inn.split("").map(Number);
  const check = (weights: number[]) => (weights.reduce((sum, w, i) => sum + w * d[i], 0) % 11) % 10;
  const ok =
    inn.length === 10
      ? check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9]
      : check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  return ok ? null : "Неверный ИНН: не сходится контрольная цифра — проверьте, нет ли опечатки";
}

export interface PartyRequisites {
  inn: string;
  fullName: string;
  shortName: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  director: string | null;
  /** Статус по ЕГРЮЛ/ЕГРИП по-русски: «Действует», «Ликвидирована» и т.д. */
  status: string | null;
  type: "LEGAL_ENTITY" | "SOLE_PROPRIETOR";
  /** Дата регистрации по реестру (для организаций — начало деятельности). */
  registrationDate: Date | null;
  /** Дата ликвидации или прекращения деятельности ИП; null — действует. */
  liquidationDate: Date | null;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Действует",
  LIQUIDATING: "Ликвидируется",
  LIQUIDATED: "Ликвидирована",
  BANKRUPT: "Банкротство",
  REORGANIZING: "Реорганизуется",
};

/** Ответ DaData (findById/party) — только поля, которые мы используем. */
interface DadataParty {
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  type?: string | null;
  name?: { full_with_opf?: string | null; short_with_opf?: string | null } | null;
  address?: { unrestricted_value?: string | null; value?: string | null } | null;
  management?: { name?: string | null; post?: string | null } | null;
  state?: { status?: string | null; registration_date?: number | null; liquidation_date?: number | null } | null;
}

/**
 * Дата из DaData — миллисекунды на полночь по Москве (UTC+3), то есть 21:00
 * предыдущего дня по UTC. Храним календарную дату (полночь UTC того же дня).
 */
export function dadataDate(ms: number | null | undefined): Date | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  const moscow = new Date(ms + 3 * 3_600_000);
  return new Date(Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), moscow.getUTCDate()));
}

/** Переводит карточку организации или ИП из ответа DaData в наши поля контрагента. */
export function mapDadataParty(data: DadataParty, fallbackInn: string): PartyRequisites {
  const fullName = data.name?.full_with_opf?.trim() || data.name?.short_with_opf?.trim() || `Контрагент ИНН ${fallbackInn}`;
  const management = data.management?.name
    ? [data.management.name, data.management.post ? `(${data.management.post.toLowerCase()})` : null].filter(Boolean).join(" ")
    : null;
  return {
    inn: data.inn || fallbackInn,
    fullName,
    shortName: data.name?.short_with_opf?.trim() || null,
    kpp: data.kpp || null,
    ogrn: data.ogrn || null,
    legalAddress: data.address?.unrestricted_value || data.address?.value || null,
    director: management,
    status: data.state?.status ? (STATUS_LABELS[data.state.status] ?? data.state.status) : null,
    type: data.type === "INDIVIDUAL" ? "SOLE_PROPRIETOR" : "LEGAL_ENTITY",
    registrationDate: dadataDate(data.state?.registration_date),
    liquidationDate: dadataDate(data.state?.liquidation_date),
  };
}

/**
 * Ключ API DaData — латинские буквы и цифры (обычно 40 шестнадцатеричных
 * знаков). Пробелы и переносы, прихваченные при копировании, убираются. Ключ
 * с русскими буквами (скопирована подпись из кабинета, набран в русской
 * раскладке) отклоняется понятным сообщением — иначе HTTP-заголовок с ним не
 * отправить, и fetch падает невнятной ошибкой про ByteString.
 */
export function normalizeApiKey(raw: string): { key: string } | { error: string } {
  const key = raw.replace(/\s/g, "");
  if (!key) return { error: "Ключ API пустой" };
  if (/[^\x21-\x7E]/.test(key)) {
    return {
      error:
        "В ключе есть русские буквы или другие недопустимые символы. Скопируйте из личного кабинета DaData только сам «API-ключ» — он состоит из латинских букв и цифр — и вставьте его без подписи",
    };
  }
  if (key.length < 20) return { error: "Ключ слишком короткий — скопируйте «API-ключ» из личного кабинета DaData целиком" };
  return { key };
}

export const DADATA_FIND_PARTY_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party";

export type InnLookupResult = { found: true; requisites: PartyRequisites } | { found: false; error: string };

/**
 * Реквизиты по ИНН через DaData (метод findById/party, головная организация).
 * fetchImpl подменяется в тестах. Ошибки сервиса превращаются в понятные
 * сообщения, а не в исключения.
 */
export async function lookupPartyByInn(inn: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<InnLookupResult> {
  const invalid = validateInn(inn);
  if (invalid) return { found: false, error: invalid };
  const normalized = normalizeApiKey(apiKey);
  if ("error" in normalized) return { found: false, error: `${normalized.error} (раздел «Реквизиты по ИНН»)` };
  let response: Response | null = null;
  // One retry: a single network hiccup or a slow answer should not stop a batch of lookups.
  for (let attempt = 0; attempt < 2 && !response; attempt++) {
    try {
      response = await fetchImpl(DADATA_FIND_PARTY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Token ${normalized.key}` },
        body: JSON.stringify({ query: inn.replace(/\s/g, ""), branch_type: "MAIN", count: 1 }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (attempt === 1) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        return {
          found: false,
          error: timeout
            ? "Сервис DaData недоступен: не ответил за 10 секунд — повторите позже"
            : `Сервис DaData недоступен: ${error instanceof Error ? error.message : "ошибка сети"}`,
        };
      }
    }
  }
  if (!response) return { found: false, error: "Сервис DaData недоступен — повторите позже" };
  if (response.status === 401 || response.status === 403) {
    return { found: false, error: "DaData отклонил ключ — проверьте ключ API в настройках «Реквизиты по ИНН»" };
  }
  if (response.status === 429) return { found: false, error: "Превышен лимит запросов DaData — повторите позже" };
  if (!response.ok) return { found: false, error: `DaData ответил ошибкой HTTP ${response.status}` };

  const body = (await response.json()) as { suggestions?: Array<{ data?: DadataParty }> };
  const party = body.suggestions?.[0]?.data;
  if (!party) return { found: false, error: `По ИНН ${inn} в ЕГРЮЛ/ЕГРИП ничего не найдено` };
  return { found: true, requisites: mapDadataParty(party, inn) };
}
