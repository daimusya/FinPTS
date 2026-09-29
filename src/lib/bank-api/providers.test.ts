import { describe, expect, it } from "vitest";
import { decryptCredentials, encryptCredentials, toOperation, type FetchResult, type HttpRequest, type HttpResponse } from "./core";
import { ALFA, fetchStatement, SBER, TBANK_BASE, TOCHKA_BASE } from "./providers";
import { syncWindow } from "./sync";

const account = { accountNumber: "40702810000000000001", bik: "044525104" };
const ok = (body: unknown): HttpResponse => ({ status: 200, text: JSON.stringify(body) });
const ops = (result: FetchResult) =>
  result.operations.map((o) => [o.date.toISOString().slice(0, 10), o.direction, Number(o.amount.toString()), o.purpose, o.counterpartyInn]);

/** Мок HTTP: отвечает по очереди и запоминает запросы. */
function mockHttp(responses: Array<HttpResponse | ((r: HttpRequest) => HttpResponse)>) {
  const requests: HttpRequest[] = [];
  const http = async (r: HttpRequest) => {
    requests.push(r);
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request ${r.url}`);
    return typeof next === "function" ? next(r) : next;
  };
  return { http, requests };
}

describe("T-Bank", () => {
  it("reads all pages of the statement with the token", async () => {
    const { http, requests } = mockHttp([
      ok({
        operations: [
          { operationId: "1", operationDate: "2026-09-28T10:15:00+03:00", typeOfOperation: "Credit", accountAmount: 12000.5, payPurpose: "Оплата по счёту 15", counterParty: { inn: "7707083893" } },
        ],
        nextCursor: "abc",
      }),
      ok({ operations: [{ operationId: "2", operationDate: "2026-09-29", typeOfOperation: "Debit", accountAmount: 300, description: "Комиссия" }] }),
    ]);
    const result = await fetchStatement("tbank", { token: "t0ken" }, account, "2026-09-28", "2026-09-29", { http });
    expect(ops(result)).toEqual([
      ["2026-09-28", "INFLOW", 12000.5, "Оплата по счёту 15", "7707083893"],
      ["2026-09-29", "OUTFLOW", 300, "Комиссия", null],
    ]);
    expect(requests[0].url.startsWith(`${TBANK_BASE}/api/v1/statement?accountNumber=40702810000000000001`)).toBe(true);
    expect(requests[0].headers?.Authorization).toBe("Bearer t0ken");
    expect(requests[1].url).toContain("cursor=abc");
  });

  it("explains a rejected token", async () => {
    const { http } = mockHttp([{ status: 401, text: "" }]);
    await expect(fetchStatement("tbank", { token: "bad" }, account, "2026-09-29", "2026-09-29", { http })).rejects.toThrow(/отклонил доступ \(401\)/);
  });
});

describe("Tochka", () => {
  it("orders a statement, waits until it is ready and takes the counterparty of each direction", async () => {
    const { http, requests } = mockHttp([
      ok({ Data: { Statement: { statementId: "st-1", status: "Created" } } }),
      ok({ Data: { Statement: [{ status: "Processing" }] } }),
      ok({
        Data: {
          Statement: [
            {
              status: "Ready",
              Transaction: [
                { creditDebitIndicator: "Credit", documentProcessDate: "2026-09-28", description: "Поступление", Amount: { amount: 5000 }, DebtorParty: { inn: "500100732259" } },
                { creditDebitIndicator: "Debit", documentProcessDate: "2026-09-29", description: "Аренда", Amount: { amount: 70000 }, CreditorParty: { inn: "7707083893" } },
                { creditDebitIndicator: "Debit", description: "без даты", Amount: { amount: 1 } },
              ],
            },
          ],
        },
      }),
    ]);
    const result = await fetchStatement("tochka", { token: "jwt" }, account, "2026-09-28", "2026-09-29", { http, wait: async () => {} });
    expect(ops(result)).toEqual([
      ["2026-09-28", "INFLOW", 5000, "Поступление", "500100732259"],
      ["2026-09-29", "OUTFLOW", 70000, "Аренда", "7707083893"],
    ]);
    expect(result.skipped).toBe(1);
    expect(JSON.parse(requests[0].body!)).toEqual({ Data: { Statement: { accountId: "40702810000000000001/044525104", startDateTime: "2026-09-28", endDateTime: "2026-09-29" } } });
    expect(requests[1].url).toBe(`${TOCHKA_BASE}/accounts/40702810000000000001%2F044525104/statements/st-1`);
  });

  it("needs the BIK of the account", async () => {
    const { http } = mockHttp([]);
    await expect(fetchStatement("tochka", { token: "jwt" }, { ...account, bik: null }, "2026-09-29", "2026-09-29", { http })).rejects.toThrow(/нужен БИК/);
  });
});

describe("Sber and Alfa", () => {
  const credentials = { clientId: "cid", clientSecret: "sec", refreshToken: "rt-1" };
  const now = new Date("2026-09-29T09:00:00Z");

  it("refreshes the token, reads each day page by page and returns the new tokens", async () => {
    const { http, requests } = mockHttp([
      ok({ access_token: "at-2", refresh_token: "rt-2", expires_in: 3600 }),
      ok({
        transactions: [
          { operationDate: "2026-09-28T00:00:00", direction: "CREDIT", amountRub: { amount: 1000 }, paymentPurpose: "Оплата", rurTransfer: { payerInn: "7707083893", payeeInn: "7700000000" } },
        ],
        _links: [{ rel: "next", href: "…" }],
      }),
      ok({ transactions: [{ operationDate: "2026-09-28", direction: "DEBIT", amount: { amount: 250 }, paymentPurpose: "Налог", rurTransfer: { payeeInn: "7727406020" } }], _links: [] }),
      { status: 404, text: "statement is not ready" }, // today — skipped until the next run
    ]);
    const result = await fetchStatement("sber", credentials, account, "2026-09-28", "2026-09-29", { http, now });
    expect(ops(result)).toEqual([
      ["2026-09-28", "INFLOW", 1000, "Оплата", "7707083893"],
      ["2026-09-28", "OUTFLOW", 250, "Налог", "7727406020"],
    ]);
    expect(requests[0].url).toBe(SBER.token);
    expect(requests[0].body).toContain("grant_type=refresh_token");
    expect(requests[1].headers?.Authorization).toBe("Bearer at-2");
    expect(requests[2].url).toContain("page=2");
    expect(result.credentials).toMatchObject({ accessToken: "at-2", refreshToken: "rt-2", accessTokenExpiresAt: "2026-09-29T10:00:00.000Z" });
  });

  it("uses a valid access token without refreshing (Alfa)", async () => {
    const { http, requests } = mockHttp([ok({ transactions: [] })]);
    await fetchStatement("alfa", { ...credentials, accessToken: "at", accessTokenExpiresAt: "2026-09-29T12:00:00Z" }, account, "2026-09-28", "2026-09-28", { http, now });
    expect(requests.map((r) => r.url.split("?")[0])).toEqual([ALFA.statement]);
  });

  it("an error on a past day is an error", async () => {
    const { http } = mockHttp([ok({ access_token: "a", expires_in: 60 }), { status: 500, text: "boom" }]);
    await expect(fetchStatement("sber", credentials, account, "2026-09-27", "2026-09-27", { http, now })).rejects.toThrow(/ошибку 500/);
  });
});

describe("statement operations and the load window", () => {
  it("keeps the bank's day and drops invalid INNs", () => {
    const op = toOperation({ date: "2026-09-29T00:30:00+03:00", direction: "INFLOW", amount: "-10,5", purpose: "  ", counterpartyInn: "12345" });
    expect([op?.date.toISOString().slice(0, 10), Number(op?.amount.toString()), op?.purpose, op?.counterpartyInn]).toEqual(["2026-09-29", 10.5, null, null]);
    expect(toOperation({ date: "вчера", direction: "INFLOW", amount: 1, purpose: null, counterpartyInn: null })).toBeNull();
  });

  it("first from the start date, then from the last success minus 3 days, never before the start", () => {
    const now = new Date("2026-09-29T09:00:00Z");
    expect(syncWindow(new Date("2026-09-01T00:00:00Z"), null, now)).toEqual({ from: "2026-09-01", to: "2026-09-29" });
    expect(syncWindow(new Date("2026-09-01T00:00:00Z"), new Date("2026-09-20T12:00:00Z"), now)).toEqual({ from: "2026-09-17", to: "2026-09-29" });
    expect(syncWindow(new Date("2026-09-19T00:00:00Z"), new Date("2026-09-20T12:00:00Z"), now)).toEqual({ from: "2026-09-19", to: "2026-09-29" });
  });

  it("credentials are stored encrypted", () => {
    process.env.AUTH_SECRET ??= "test-secret-for-vitest";
    const encrypted = encryptCredentials({ token: "secret-token-1234" });
    expect(encrypted).not.toContain("secret-token");
    expect(decryptCredentials(encrypted)).toEqual({ token: "secret-token-1234" });
  });
});
