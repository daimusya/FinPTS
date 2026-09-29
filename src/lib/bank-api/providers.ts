import {
  BankApiError,
  daysBetween,
  loadCertificate,
  parseJson,
  text,
  toOperation,
  type BankAccountRef,
  type BankCredentials,
  type BankProvider,
  type FetchResult,
  type HttpClient,
} from "./core";
import type { StatementOperation } from "@/lib/bank-import/import-operations";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function collect(raw: unknown[], map: (o: Json) => StatementOperation | null): { operations: StatementOperation[]; skipped: number } {
  const operations: StatementOperation[] = [];
  let skipped = 0;
  for (const item of raw) {
    const op = map(obj(item));
    if (op) operations.push(op);
    else skipped += 1;
  }
  return { operations, skipped };
}

// ---------------------------------------------------------------------------
// Т-Банк: Open API бизнеса, токен из интернет-банка (Bearer)
// ---------------------------------------------------------------------------

export const TBANK_BASE = "https://business.tbank.ru/openapi";

/** Операция выписки Т-Банка: typeOfOperation Credit — поступление, Debit — списание. */
export function mapTbankOperation(o: Json): StatementOperation | null {
  const type = text(o.typeOfOperation)?.toLowerCase();
  const counterParty = obj(o.counterParty);
  return toOperation({
    date: o.operationDate ?? o.date ?? o.chargeDate,
    direction: type === "credit" ? "INFLOW" : type === "debit" ? "OUTFLOW" : null,
    amount: o.accountAmount ?? o.operationAmount ?? o.amount,
    purpose: o.payPurpose ?? o.description,
    counterpartyInn: counterParty.inn,
  });
}

async function fetchTbank(credentials: BankCredentials, account: BankAccountRef, from: string, to: string, http: HttpClient): Promise<FetchResult> {
  if (!credentials.token) throw new BankApiError("Не задан токен Т-Банка");
  const raw: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 200; page++) {
    const params = new URLSearchParams({ accountNumber: account.accountNumber, from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z`, limit: "5000" });
    if (cursor) params.set("cursor", cursor);
    const body = obj(
      parseJson(await http({ method: "GET", url: `${TBANK_BASE}/api/v1/statement?${params}`, headers: { Authorization: `Bearer ${credentials.token}` } }), "Выписка Т-Банка"),
    );
    raw.push(...arr(body.operations));
    cursor = text(body.nextCursor);
    if (!cursor) break;
  }
  return collect(raw, mapTbankOperation);
}

// ---------------------------------------------------------------------------
// Точка: Open Banking API v1.0, JWT-токен из интернет-банка (Bearer)
// ---------------------------------------------------------------------------

export const TOCHKA_BASE = "https://enter.tochka.com/uapi/open-banking/v1.0";

/** Транзакция Точки: creditDebitIndicator Credit — поступление; контрагент — плательщик или получатель. */
export function mapTochkaTransaction(t: Json): StatementOperation | null {
  const indicator = text(t.creditDebitIndicator)?.toLowerCase();
  const direction = indicator === "credit" ? "INFLOW" : indicator === "debit" ? "OUTFLOW" : null;
  const party = obj(direction === "INFLOW" ? t.DebtorParty : t.CreditorParty);
  return toOperation({
    date: t.documentProcessDate ?? t.bookingDateTime ?? t.valueDateTime,
    direction,
    amount: obj(t.Amount).amount ?? t.amount,
    purpose: t.description,
    counterpartyInn: party.inn,
  });
}

async function fetchTochka(
  credentials: BankCredentials,
  account: BankAccountRef,
  from: string,
  to: string,
  http: HttpClient,
  wait: (ms: number) => Promise<void>,
): Promise<FetchResult> {
  if (!credentials.token) throw new BankApiError("Не задан токен Точки");
  if (!account.bik) throw new BankApiError("Для Точки у счёта нужен БИК — заполните его в справочнике «Банковские счета»");
  const accountId = `${account.accountNumber}/${account.bik}`;
  const headers = { Authorization: `Bearer ${credentials.token}`, "Content-Type": "application/json" };
  // A statement is ordered first and then polled until the bank has built it.
  const created = obj(
    parseJson(
      await http({
        method: "POST",
        url: `${TOCHKA_BASE}/statements`,
        headers,
        body: JSON.stringify({ Data: { Statement: { accountId, startDateTime: from, endDateTime: to } } }),
      }),
      "Заказ выписки Точки",
    ),
  );
  const statementId = text(obj(obj(created.Data).Statement).statementId);
  if (!statementId) throw new BankApiError("Точка не вернула номер выписки");
  for (let attempt = 0; attempt < 20; attempt++) {
    const body = obj(
      parseJson(
        await http({ method: "GET", url: `${TOCHKA_BASE}/accounts/${encodeURIComponent(accountId)}/statements/${encodeURIComponent(statementId)}`, headers }),
        "Выписка Точки",
      ),
    );
    const statement = obj(arr(obj(body.Data).Statement)[0]);
    const status = text(statement.status)?.toLowerCase();
    if (status === "ready") return collect(arr(statement.Transaction), mapTochkaTransaction);
    if (status === "error") throw new BankApiError("Точка не смогла сформировать выписку");
    await wait(1500);
  }
  throw new BankApiError("Точка долго формирует выписку — попробуйте ещё раз позже");
}

// ---------------------------------------------------------------------------
// Сбер и Альфа: выписка по дням (statement/transactions), OAuth 2.0 и клиентский сертификат
// ---------------------------------------------------------------------------

export const SBER = {
  token: "https://fintech.sberbank.ru:9443/ic/sso/api/v2/oauth/token",
  statement: "https://fintech.sberbank.ru:9443/fintech/api/v2/statement/transactions",
};
export const ALFA = {
  token: "https://baas.alfabank.ru/oidc/token",
  statement: "https://baas.alfabank.ru/api/statement/transactions",
};

/** Операция выписки Сбера и Альфы: direction CREDIT — поступление; ИНН контрагента — из rurTransfer. */
export function mapStatementTransaction(t: Json): StatementOperation | null {
  const direction = text(t.direction)?.toUpperCase();
  const transfer = obj(t.rurTransfer);
  const inflow = direction === "CREDIT";
  return toOperation({
    date: t.operationDate ?? t.documentDate,
    direction: inflow ? "INFLOW" : direction === "DEBIT" ? "OUTFLOW" : null,
    amount: obj(t.amountRub).amount ?? obj(t.amount).amount ?? t.amount,
    purpose: t.paymentPurpose ?? t.purpose,
    counterpartyInn: inflow ? transfer.payerInn : transfer.payeeInn,
  });
}

/** Токен доступа OAuth: действующий — как есть, иначе обновляется по refresh_token (новые токены сохраняются). */
async function accessToken(
  credentials: BankCredentials,
  tokenUrl: string,
  http: HttpClient,
  cert: { pfx?: Buffer; passphrase?: string },
  now: Date,
): Promise<{ token: string; credentials?: BankCredentials }> {
  if (credentials.accessToken && credentials.accessTokenExpiresAt && Date.parse(credentials.accessTokenExpiresAt) - 60_000 > now.getTime()) {
    return { token: credentials.accessToken };
  }
  if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
    throw new BankApiError("Не заданы client_id, client_secret или refresh_token приложения банка");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: credentials.refreshToken,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  }).toString();
  const json = obj(
    parseJson(
      await http({ method: "POST", url: tokenUrl, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, ...cert }),
      "Обновление токена банка",
    ),
  );
  const token = text(json.access_token);
  if (!token) throw new BankApiError("Банк не выдал токен доступа — выпустите refresh_token заново");
  const expiresIn = Number(json.expires_in) || 3600;
  return {
    token,
    credentials: {
      ...credentials,
      accessToken: token,
      accessTokenExpiresAt: new Date(now.getTime() + expiresIn * 1000).toISOString(),
      refreshToken: text(json.refresh_token) ?? credentials.refreshToken,
    },
  };
}

async function fetchByDays(
  urls: { token: string; statement: string },
  bankName: string,
  credentials: BankCredentials,
  account: BankAccountRef,
  from: string,
  to: string,
  http: HttpClient,
  now: Date,
): Promise<FetchResult> {
  const cert = loadCertificate(credentials);
  const { token, credentials: updated } = await accessToken(credentials, urls.token, http, cert, now);
  const today = now.toISOString().slice(0, 10);
  const raw: unknown[] = [];
  for (const day of daysBetween(from, to)) {
    for (let page = 1; page <= 100; page++) {
      const params = new URLSearchParams({ accountNumber: account.accountNumber, statementDate: day, page: String(page) });
      const response = await http({ method: "GET", url: `${urls.statement}?${params}`, headers: { Authorization: `Bearer ${token}` }, ...cert });
      // The statement of the current day may not be ready yet — it will be taken on the next run.
      if (day === today && response.status >= 400 && response.status !== 401 && response.status !== 403) break;
      const body = obj(parseJson(response, `Выписка ${bankName} за ${day}`));
      raw.push(...arr(body.transactions));
      const next = arr(body._links).some((l) => text(obj(l).rel) === "next");
      if (!next) break;
    }
  }
  return { ...collect(raw, mapStatementTransaction), credentials: updated };
}

// ---------------------------------------------------------------------------

export interface FetchOptions {
  http?: HttpClient;
  now?: Date;
  wait?: (ms: number) => Promise<void>;
}

/** Операции выписки счёта за период (ГГГГ-ММ-ДД включительно) из API банка. */
export async function fetchStatement(
  provider: BankProvider,
  credentials: BankCredentials,
  account: BankAccountRef,
  from: string,
  to: string,
  options: FetchOptions & { http: HttpClient },
): Promise<FetchResult> {
  const now = options.now ?? new Date();
  switch (provider) {
    case "tbank":
      return fetchTbank(credentials, account, from, to, options.http);
    case "tochka":
      return fetchTochka(credentials, account, from, to, options.http, options.wait ?? sleep);
    case "sber":
      return fetchByDays(SBER, "Сбера", credentials, account, from, to, options.http, now);
    case "alfa":
      return fetchByDays(ALFA, "Альфа-Банка", credentials, account, from, to, options.http, now);
  }
}
