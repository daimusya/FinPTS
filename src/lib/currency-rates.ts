import Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import {
  addNative,
  BASE_CURRENCY,
  CBR_CURRENCY_IDS,
  cbrRequestDate,
  normalizeCurrency,
  parseCbrDaily,
  parseCbrDynamic,
  RateLookup,
  revalueBalances,
  transactionCurrency,
} from "@/lib/currency";

/** Все курсы (без архивных) — для пересчёта в отчётах. */
export async function loadRateLookup(): Promise<RateLookup> {
  const rows = await prisma.currencyRate.findMany({ where: { isArchived: false }, select: { currency: true, date: true, rate: true } });
  return new RateLookup(rows);
}

/** Валюты действующих счетов и касс, кроме рубля. */
export async function accountCurrencies(): Promise<string[]> {
  const [banks, cash] = await Promise.all([
    prisma.bankAccount.findMany({ where: { isArchived: false }, select: { currency: true } }),
    prisma.cashAccount.findMany({ where: { isArchived: false }, select: { currency: true } }),
  ]);
  return [...new Set([...banks, ...cash].map((a) => normalizeCurrency(a.currency)))].filter((c) => c !== BASE_CURRENCY).sort();
}

const CBR = "https://www.cbr.ru/scripts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

/**
 * Запрос к сайту ЦБ. Сайт защищён от частых запросов (DDoS-Guard отвечает
 * 403 на серию запросов подряд): между запросами пауза, при 403 и 429 —
 * повтор с нарастающим ожиданием.
 */
async function getCbr(url: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "PROMTEHNOSFERA finance platform" } });
    if (response.ok) return new TextDecoder("windows-1251").decode(await response.arrayBuffer());
    if ((response.status === 403 || response.status === 429) && attempt < 3) {
      await sleep(4000 * (attempt + 1));
      continue;
    }
    throw new Error(`ЦБ РФ ответил ${response.status}`);
  }
}

export interface CbrLoadResult {
  saved: number;
  currencies: string[];
  unknown: string[];
}

/**
 * Загрузка официальных курсов ЦБ РФ за период для указанных валют. Курс,
 * введённый вручную, не перезаписывается; курс ЦБ на ту же дату — обновляется.
 */
export async function loadCbrRates(from: Date, to: Date, currenciesRaw: string[]): Promise<CbrLoadResult> {
  const currencies = [...new Set(currenciesRaw.map(normalizeCurrency))].filter((c) => c !== BASE_CURRENCY);
  if (currencies.length === 0) return { saved: 0, currencies: [], unknown: [] };
  // The bank's internal codes of the currencies (needed for the history request): known ones, else from the daily list.
  const ids = new Map(currencies.filter((c) => CBR_CURRENCY_IDS[c]).map((c) => [c, CBR_CURRENCY_IDS[c]]));
  if (currencies.some((c) => !ids.has(c))) {
    const daily = parseCbrDaily(await getCbr(`${CBR}/XML_daily.asp?date_req=${cbrRequestDate(to)}`));
    for (const r of daily.rates) if (!ids.has(r.currency)) ids.set(r.currency, r.cbrId);
  }
  const unknown = currencies.filter((c) => !ids.has(c));

  const manual = await prisma.currencyRate.findMany({
    where: { currency: { in: currencies }, date: { gte: from, lte: to }, source: "manual", isArchived: false },
    select: { currency: true, date: true },
  });
  const keep = new Set(manual.map((m) => `${m.currency}:${m.date.toISOString().slice(0, 10)}`));

  let saved = 0;
  for (const currency of currencies) {
    const id = ids.get(currency);
    if (!id) continue;
    const history = parseCbrDynamic(
      await getCbr(`${CBR}/XML_dynamic.asp?date_req1=${cbrRequestDate(from)}&date_req2=${cbrRequestDate(to)}&VAL_NM_RQ=${encodeURIComponent(id)}`),
    );
    for (const point of history) {
      if (keep.has(`${currency}:${point.date.toISOString().slice(0, 10)}`)) continue;
      await prisma.currencyRate.upsert({
        where: { currency_date: { currency, date: point.date } },
        create: { currency, date: point.date, rate: point.rate.toFixed(6), source: "cbr" },
        update: { rate: point.rate.toFixed(6), source: "cbr", isArchived: false },
      });
      saved++;
    }
  }
  return { saved, currencies: currencies.filter((c) => ids.has(c)), unknown };
}

/**
 * Остаток денег по операциям в рублях на дату: остатки по валютам счетов,
 * валютные — по курсу ЦБ на эту дату.
 */
export async function cashBalanceRub(
  where: Prisma.BankTransactionWhereInput,
  date: Date = new Date(),
): Promise<{ total: Decimal; byCurrency: Map<string, Decimal>; missingRates: string | null }> {
  const [transactions, rates] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      select: { amount: true, direction: true, bankAccount: { select: { currency: true } }, cashAccount: { select: { currency: true } } },
    }),
    loadRateLookup(),
  ]);
  const byCurrency = new Map<string, Decimal>();
  for (const t of transactions) {
    const amount = toDecimal(t.amount);
    addNative(byCurrency, transactionCurrency(t), t.direction === "INFLOW" ? amount : amount.negated());
  }
  return { total: revalueBalances(byCurrency, date, rates), byCurrency, missingRates: rates.missingText() };
}

/** Поступления и выплаты в рублях — каждая операция по курсу ЦБ на свою дату. */
export async function flowsRub(where: Prisma.BankTransactionWhereInput): Promise<{ inflow: Decimal; outflow: Decimal }> {
  const [transactions, rates] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      select: {
        amount: true,
        direction: true,
        operationDate: true,
        bankAccount: { select: { currency: true } },
        cashAccount: { select: { currency: true } },
      },
    }),
    loadRateLookup(),
  ]);
  let inflow = new Decimal(0);
  let outflow = new Decimal(0);
  for (const t of transactions) {
    const rub = rates.toRub(t.amount, transactionCurrency(t), t.operationDate);
    if (t.direction === "INFLOW") inflow = inflow.plus(rub);
    else outflow = outflow.plus(rub);
  }
  return { inflow, outflow };
}

/**
 * Для планировщика: загрузить курсы ЦБ за последнюю неделю для валют счетов,
 * если сегодняшнего курса ещё нет. Возвращает строку для журнала или null —
 * загружать было нечего.
 */
export async function ensureRecentRates(now: Date = new Date()): Promise<string | null> {
  const currencies = await accountCurrencies();
  if (currencies.length === 0) return null;
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const have = await prisma.currencyRate.findMany({ where: { currency: { in: currencies }, date: today, isArchived: false }, select: { currency: true } });
  const need = currencies.filter((c) => !have.some((h) => h.currency === c));
  if (need.length === 0) return null;
  const result = await loadCbrRates(new Date(today.getTime() - 7 * 86_400_000), today, need);
  return `курсы ЦБ: ${result.currencies.join(", ") || "—"}, записей ${result.saved}${result.unknown.length ? `; ЦБ не устанавливает: ${result.unknown.join(", ")}` : ""}`;
}
