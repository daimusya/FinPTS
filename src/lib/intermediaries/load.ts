import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { bankTransactionScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";
import { buildCommissionMonth, type CommissionMonth, type InflowRow, type IntermediaryInfo } from "./commissions";
import { parseStoredScale, SCALE_SETTING_KEY, type ScaleTier } from "./standard-scale";
import type { MatcherBinding } from "./matching";

export interface YearMonth {
  year: number;
  month: number;
}

/** «2026-09» → { 2026, 9 }; неверное значение — null. */
export function parseMonthParam(value: string | undefined | null): YearMonth | null {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
}

export const monthParam = (ym: YearMonth) => `${ym.year}-${String(ym.month).padStart(2, "0")}`;

export function shiftMonth(ym: YearMonth, delta: number): YearMonth {
  const index = ym.year * 12 + ym.month - 1 + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const monthStart = (ym: YearMonth) => new Date(Date.UTC(ym.year, ym.month - 1, 1));

/** Месяц по умолчанию — последний, за который загружены поступления (не позже текущего). */
export async function defaultMonth(scope: AccessScope, now = new Date()): Promise<YearMonth> {
  const current = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const latest = await prisma.bankTransaction.findFirst({
    where: { direction: "INFLOW", isTransfer: false, operationDate: { lt: monthStart(shiftMonth(current, 1)) }, ...bankTransactionScopeWhere(scope) },
    orderBy: { operationDate: "desc" },
    select: { operationDate: true },
  });
  return latest ? { year: latest.operationDate.getUTCFullYear(), month: latest.operationDate.getUTCMonth() + 1 } : current;
}

export interface CommissionContext {
  intermediaries: IntermediaryInfo[];
  bindings: MatcherBinding[];
  ownInns: Set<string>;
  scale: ScaleTier[];
}

/** Шкала «Стандарта» из настроек (не задана — 5/10/15%). */
export async function loadStandardScale(): Promise<ScaleTier[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: SCALE_SETTING_KEY } });
  return parseStoredScale(row?.value);
}

export async function loadCommissionContext(): Promise<CommissionContext> {
  const [intermediaries, bindings, organizations, scale] = await Promise.all([
    prisma.intermediary.findMany({
      where: { isArchived: false },
      orderBy: { name: "asc" },
      include: {
        clients: { select: { id: true, name: true }, orderBy: { name: "asc" } },
        rates: { select: { validFrom: true, commissionPct: true }, orderBy: { validFrom: "asc" } },
      },
    }),
    prisma.intermediaryPayer.findMany({ select: { inn: true, intermediaryId: true } }),
    prisma.organization.findMany({ where: { inn: { not: null } }, select: { inn: true } }),
    loadStandardScale(),
  ]);
  return {
    intermediaries: intermediaries.map((m) => ({
      id: m.id,
      name: m.name,
      reportName: m.reportName,
      category: m.category,
      turnoverFrom: m.turnoverFrom,
      commissionPct: m.commissionPct === null ? null : new Decimal(m.commissionPct.toString()),
      rateChanges: m.rates.map((r) => ({ from: r.validFrom, pct: new Decimal(r.commissionPct.toString()) })),
      clients: m.clients,
    })),
    bindings,
    ownInns: new Set(organizations.map((o) => o.inn!).filter(Boolean)),
    scale,
  };
}

/** Поступления за месяцы [from, to] включительно, видимые пользователю, без переводов между своими счетами. */
export function loadInflows(scope: AccessScope, from: YearMonth, to: YearMonth): Promise<InflowRow[]> {
  return loadInflowsBetween(scope, monthStart(from), monthStart(shiftMonth(to, 1)));
}

/** Поступления с даты from (null — с самого начала) до даты before (не включая её). */
export async function loadInflowsBetween(scope: AccessScope, from: Date | null, before: Date): Promise<InflowRow[]> {
  const rows = await prisma.bankTransaction.findMany({
    where: {
      direction: "INFLOW",
      isTransfer: false,
      operationDate: { ...(from ? { gte: from } : {}), lt: before },
      ...bankTransactionScopeWhere(scope),
    },
    orderBy: { operationDate: "asc" },
    select: {
      id: true,
      operationDate: true,
      amount: true,
      purpose: true,
      counterpartyInn: true,
      counterpartyName: true,
      counterparty: { select: { shortName: true, fullName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.operationDate,
    amount: new Decimal(r.amount.toString()),
    purpose: r.purpose,
    payerInn: r.counterpartyInn,
    // Операции, загруженные до того, как стали хранить наименование, — по контрагенту из справочника.
    payerName: r.counterpartyName ?? r.counterparty?.shortName ?? r.counterparty?.fullName ?? null,
  }));
}

export const sameMonth = (date: Date, ym: YearMonth) => date.getUTCFullYear() === ym.year && date.getUTCMonth() + 1 === ym.month;

/**
 * Поступления и комиссии посредников за любой период: справочник и карточка
 * посредника. Комиссия — ставка от суммы за весь период.
 */
export async function loadCommissionPeriod(scope: AccessScope, from: Date | null, before: Date) {
  const context = await loadCommissionContext();
  const [inflows, priorTurnover] = await Promise.all([loadInflowsBetween(scope, from, before), loadPriorTurnover(context, from)]);
  return { context, period: buildCommissionMonth(context.intermediaries, context.bindings, inflows, context.ownInns, { scale: context.scale, priorTurnover }) };
}

/**
 * «Стандарт»: оборот, накопленный каждым посредником до даты before (с даты
 * начала его оборота). Считается по всем операциям, а не только видимым
 * пользователю: ставка посредника не должна зависеть от того, кто смотрит.
 */
export async function loadPriorTurnover(context: CommissionContext, before: Date | null): Promise<Map<string, Decimal>> {
  const standard = context.intermediaries.filter((m) => m.category === "STANDARD");
  if (!before || standard.length === 0) return new Map();
  const starts = standard.map((m) => m.turnoverFrom);
  const earliest = starts.includes(null) ? null : new Date(Math.min(...starts.map((d) => d!.getTime())));
  if (earliest && earliest >= before) return new Map();
  const inflows = await loadInflowsBetween(UNRESTRICTED_SCOPE, earliest, before);
  return buildCommissionMonth(standard, context.bindings, inflows, context.ownInns, { scale: context.scale }).turnoverAfter;
}

/** Расчёт за месяц и помесячная динамика комиссий за 12 месяцев до него включительно. */
export async function loadCommissionDashboard(scope: AccessScope, ym: YearMonth) {
  const context = await loadCommissionContext();
  const firstMonth = shiftMonth(ym, -11);
  const [inflows, prior] = await Promise.all([loadInflows(scope, firstMonth, ym), loadPriorTurnover(context, monthStart(firstMonth))]);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(firstMonth, i));
  let priorTurnover = prior;
  const perMonth: Array<{ ym: YearMonth; data: CommissionMonth }> = months.map((m) => {
    const data = buildCommissionMonth(context.intermediaries, context.bindings, inflows.filter((op) => sameMonth(op.date, m)), context.ownInns, {
      scale: context.scale,
      priorTurnover,
    });
    priorTurnover = new Map([...priorTurnover, ...data.turnoverAfter]);
    return { ym: m, data };
  });
  return { context, current: perMonth[perMonth.length - 1].data, trend: perMonth };
}
