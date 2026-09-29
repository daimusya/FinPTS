import https from "node:https";
import fs from "node:fs";
import Decimal from "decimal.js";
import type { StatementOperation } from "@/lib/bank-import/import-operations";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secret-box";

/**
 * Общее для API банков: провайдеры, реквизиты подключения (хранятся
 * зашифрованными), HTTP-клиент (с клиентским сертификатом для Сбера и
 * Альфы) и разбор ответов в операции выписки.
 */
export type BankProvider = "tbank" | "tochka" | "sber" | "alfa";

export const BANK_PROVIDERS: BankProvider[] = ["tbank", "tochka", "sber", "alfa"];

export const BANK_PROVIDER_LABELS: Record<BankProvider, string> = {
  tbank: "Т-Банк (Тинькофф Бизнес)",
  tochka: "Точка",
  sber: "Сбер (СберБизнес API)",
  alfa: "Альфа-Банк (Alfa API)",
};

export function isBankProvider(value: string): value is BankProvider {
  return (BANK_PROVIDERS as string[]).includes(value);
}

/** Реквизиты подключения: у Т-Банка и Точки — токен; у Сбера и Альфы — OAuth-клиент, токены и сертификат. */
export interface BankCredentials {
  token?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  accessToken?: string;
  /** ISO-время окончания accessToken. */
  accessTokenExpiresAt?: string;
  /** Путь к клиентскому сертификату .pfx / .p12 на этом компьютере и пароль к нему. */
  certPath?: string;
  certPassword?: string;
}

export class BankApiError extends Error {}

// ---------------------------------------------------------------------------
// Реквизиты
// ---------------------------------------------------------------------------

/** Реквизиты — JSON, зашифрованный тем же способом, что и другие секреты интеграций (secret-box, ключ из AUTH_SECRET). */
export function encryptCredentials(credentials: BankCredentials): string {
  return encryptSecret(JSON.stringify(credentials));
}

export function decryptCredentials(value: string): BankCredentials {
  try {
    return JSON.parse(decryptSecret(value));
  } catch {
    throw new BankApiError("Не удалось расшифровать реквизиты банка — возможно, изменился AUTH_SECRET. Замените реквизиты подключения");
  }
}

/** Какие реквизиты подключения заданы — для экрана, без самих значений (последние 4 символа токена). */
export function describeCredentials(encrypted: string): string {
  try {
    const c = decryptCredentials(encrypted);
    if (c.token) return `токен ${maskSecret(c.token)}`;
    return [c.clientId ? `client_id ${maskSecret(c.clientId)}` : null, c.refreshToken ? "refresh_token задан" : null, c.certPath ? "сертификат задан" : null]
      .filter(Boolean)
      .join(", ");
  } catch (error) {
    return (error as Error).message;
  }
}

/** Последние символы секрета для экрана: «…a1b2». */
function maskSecret(value: string | undefined): string {
  return value ? `…${value.slice(-4)}` : "—";
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

export interface HttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Клиентский сертификат (mTLS). */
  pfx?: Buffer;
  passphrase?: string;
}

export interface HttpResponse {
  status: number;
  text: string;
}

export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

/** HTTP-клиент на node:https — умеет клиентский сертификат; таймаут 60 секунд. */
export const defaultHttpClient: HttpClient = (request) =>
  new Promise((resolve, reject) => {
    const url = new URL(request.url);
    const req = https.request(
      {
        method: request.method,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        headers: { Accept: "application/json", ...(request.body ? { "Content-Length": Buffer.byteLength(request.body).toString() } : {}), ...request.headers },
        pfx: request.pfx,
        passphrase: request.passphrase,
        timeout: 60_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new BankApiError("Банк не ответил за 60 секунд")));
    req.on("error", (e) => reject(e instanceof BankApiError ? e : new BankApiError(`Нет связи с банком: ${e.message}`)));
    if (request.body) req.write(request.body);
    req.end();
  });

/** Разбор ответа: 401/403 — понятное сообщение про токен, другие ошибки — код и начало ответа банка. */
export function parseJson(response: HttpResponse, what: string): unknown {
  if (response.status === 401 || response.status === 403) {
    throw new BankApiError(`${what}: банк отклонил доступ (${response.status}) — проверьте токен или права приложения на чтение выписки`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new BankApiError(`${what}: банк вернул ошибку ${response.status}${response.text ? ` — ${response.text.slice(0, 300)}` : ""}`);
  }
  try {
    return response.text ? JSON.parse(response.text) : {};
  } catch {
    throw new BankApiError(`${what}: ответ банка — не JSON`);
  }
}

export function loadCertificate(credentials: BankCredentials): { pfx?: Buffer; passphrase?: string } {
  if (!credentials.certPath) return {};
  try {
    return { pfx: fs.readFileSync(credentials.certPath), passphrase: credentials.certPassword };
  } catch {
    throw new BankApiError(`Не удалось прочитать сертификат ${credentials.certPath} — проверьте путь к файлу .pfx`);
  }
}

// ---------------------------------------------------------------------------
// Разбор операций
// ---------------------------------------------------------------------------

/** День операции без сдвига часовых поясов: берутся «ГГГГ-ММ-ДД» из начала строки банка. */
export function operationDay(value: unknown): Date | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function positiveAmount(value: unknown): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const d = new Decimal(String(value).replace(",", "."));
    return d.isFinite() && !d.isZero() ? d.abs() : null;
  } catch {
    return null;
  }
}

export const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Операция выписки из разобранных полей; null — операция неполная (нет даты, суммы или направления). */
export function toOperation(fields: {
  date: unknown;
  direction: "INFLOW" | "OUTFLOW" | null;
  amount: unknown;
  purpose: unknown;
  counterpartyInn: unknown;
}): StatementOperation | null {
  const date = operationDay(fields.date);
  const amount = positiveAmount(fields.amount);
  if (!date || !amount || !fields.direction) return null;
  const inn = text(fields.counterpartyInn);
  return { date, direction: fields.direction, amount, purpose: text(fields.purpose), counterpartyInn: inn && /^\d{10}(\d{2})?$/.test(inn) ? inn : null };
}

/** Дни от from до to включительно (ГГГГ-ММ-ДД). */
export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += 86_400_000) days.push(new Date(ms).toISOString().slice(0, 10));
  return days;
}

export interface FetchResult {
  operations: StatementOperation[];
  /** Сколько операций банка пропущено как неполные. */
  skipped: number;
  /** Обновлённые реквизиты (новые токены OAuth) — сохранить. */
  credentials?: BankCredentials;
}

export interface BankAccountRef {
  accountNumber: string;
  bik: string | null;
}
