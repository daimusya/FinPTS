import { describe, expect, it, vi } from "vitest";
import { DADATA_FIND_PARTY_URL, lookupPartyByInn, mapDadataParty, validateInn } from "./inn";

describe("validateInn", () => {
  it("accepts real organization and individual INNs", () => {
    expect(validateInn("7707083893")).toBeNull(); // ПАО Сбербанк
    expect(validateInn("7736207543")).toBeNull(); // ООО «Яндекс»
    expect(validateInn("500100732259")).toBeNull(); // 12-digit INN with valid control digits
  });

  it("rejects typos and wrong lengths", () => {
    expect(validateInn("7707083894")).toContain("контрольная цифра");
    expect(validateInn("500100732258")).toContain("контрольная цифра");
    expect(validateInn("770708389")).toContain("10 цифр");
    expect(validateInn("77070838AB")).toContain("10 цифр");
  });
});

// Shape of a DaData findById/party suggestion (documented response, trimmed to the fields we use).
const legal = {
  inn: "7707083893",
  kpp: "773601001",
  ogrn: "1027700132195",
  type: "LEGAL",
  name: { full_with_opf: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО "СБЕРБАНК РОССИИ"', short_with_opf: "ПАО СБЕРБАНК" },
  address: { value: "г Москва, ул Вавилова, д 19", unrestricted_value: "117312, г Москва, Академический р-н, ул Вавилова, д 19" },
  management: { name: "Греф Герман Оскарович", post: "ПРЕЗИДЕНТ, ПРЕДСЕДАТЕЛЬ ПРАВЛЕНИЯ" },
  state: { status: "ACTIVE" },
};

describe("mapDadataParty", () => {
  it("maps an organization to counterparty fields", () => {
    expect(mapDadataParty(legal, "7707083893")).toEqual({
      inn: "7707083893",
      fullName: 'ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО "СБЕРБАНК РОССИИ"',
      shortName: "ПАО СБЕРБАНК",
      kpp: "773601001",
      ogrn: "1027700132195",
      legalAddress: "117312, г Москва, Академический р-н, ул Вавилова, д 19",
      director: "Греф Герман Оскарович (президент, председатель правления)",
      status: "Действует",
      type: "LEGAL_ENTITY",
    });
  });

  it("maps a sole proprietor without KPP or management", () => {
    const r = mapDadataParty(
      {
        inn: "500100732259",
        ogrn: "304500116000157",
        type: "INDIVIDUAL",
        name: { full_with_opf: "Индивидуальный предприниматель Иванов Иван Иванович", short_with_opf: "ИП Иванов Иван Иванович" },
        state: { status: "LIQUIDATED" },
      },
      "500100732259",
    );
    expect(r).toMatchObject({ type: "SOLE_PROPRIETOR", kpp: null, director: null, status: "Ликвидирована", shortName: "ИП Иванов Иван Иванович" });
  });
});

describe("lookupPartyByInn", () => {
  const respond = (status: number, body: unknown) =>
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

  it("sends the INN with the token and returns the mapped requisites", async () => {
    const fetchMock = respond(200, { suggestions: [{ value: "ПАО СБЕРБАНК", data: legal }] });
    const r = await lookupPartyByInn("7707083893", "secret-key", fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ found: true, requisites: { kpp: "773601001", status: "Действует" } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DADATA_FIND_PARTY_URL);
    expect(init.headers.Authorization).toBe("Token secret-key");
    expect(JSON.parse(init.body)).toEqual({ query: "7707083893", branch_type: "MAIN", count: 1 });
  });

  it("turns service answers into readable errors and skips the call for an invalid INN", async () => {
    expect(await lookupPartyByInn("7707083893", "k", respond(200, { suggestions: [] }) as unknown as typeof fetch)).toEqual({
      found: false,
      error: "По ИНН 7707083893 в ЕГРЮЛ/ЕГРИП ничего не найдено",
    });
    expect(await lookupPartyByInn("7707083893", "bad", respond(403, {}) as unknown as typeof fetch)).toMatchObject({
      found: false,
      error: expect.stringContaining("отклонил ключ"),
    });
    const neverCalled = vi.fn();
    expect(await lookupPartyByInn("7707083894", "k", neverCalled as unknown as typeof fetch)).toMatchObject({ found: false });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("reports an unreachable service instead of throwing", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    expect(await lookupPartyByInn("7707083893", "k", failing as unknown as typeof fetch)).toMatchObject({
      found: false,
      error: expect.stringContaining("недоступен"),
    });
  });
});
