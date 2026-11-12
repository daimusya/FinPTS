import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { bankTransactionScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";
import { buildCommissionMonth, type CommissionMonth, type InflowRow, type IntermediaryInfo, type TurnoverCheckpoint } from "./commissions";
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
  const before = monthStart(shiftMonth(current, 1));
  const [bank, manual] = await Promise.all([
    prisma.bankTransaction.findFirst({
      where: { direction: "INFLOW", isTransfer: false, operationDate: { lt: before }, ...bankTransactionScopeWhere(scope) },
      orderBy: { operationDate: "desc" },
      select: { operationDate: true },
    }),
    scope.departmentIds || scope.projectIds ? null : prisma.intermediaryReceipt.findFirst({
      where: { date: { lt: before }, intermediary: { isArchived: false }, ...(scope.organizationIds ? { organizationId: { in: scope.organizationIds } } : {}) },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);
  const latest = manual && (!bank || manual.date > bank.operationDate) ? manual.date : bank?.operationDate;
  return latest ? { year: latest.getUTCFullYear(), month: latest.getUTCMonth() + 1 } : current;
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
  const dates = { ...(from ? { gte: from } : {}), lt: before };
  const [rows, manual] = await Promise.all([prisma.bankTransaction.findMany({
    where: {
      direction: "INFLOW",
      isTransfer: false,
      operationDate: dates,
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
      commissionIntermediaryId: true,
      counterparty: { select: { inn: true, shortName: true, fullName: true } },
    },
  }), scope.departmentIds || scope.projectIds ? [] : prisma.intermediaryReceipt.findMany({
    where: { date: dates, ...(scope.organizationIds ? { organizationId: { in: scope.organizationIds } } : {}) },
    select: { id: true, date: true, amount: true, payerName: true, purpose: true, intermediaryId: true, organizationId: true },
  })]);
  const imported = rows.map((r) => ({
    id: r.id,
    date: r.operationDate,
    amount: new Decimal(r.amount.toString()),
    purpose: r.purpose,
    payerInn: r.counterpartyInn ?? r.counterparty?.inn ?? null,
    confirmedIntermediaryId: r.commissionIntermediaryId ?? undefined,
    // Операции, загруженные до того, как стали хранить наименование, — по контрагенту из справочника.
    payerName: r.counterpartyName ?? r.counterparty?.shortName ?? r.counterparty?.fullName ?? null,
  }));
  return [...imported, ...manual.map(({ intermediaryId, organizationId, ...r }) => ({
    ...r, amount: new Decimal(r.amount.toString()), payerInn: null, manualIntermediaryId: intermediaryId, manualOrganizationId: organizationId,
  }))];
}

export const sameMonth = (date: Date, ym: YearMonth) => date.getUTCFullYear() === ym.year && date.getUTCMonth() + 1 === ym.month;

/**
 * Поступления и комиссии посредников за любой период: справочник и карточка
 * посредника. Комиссия — ставка от суммы за весь период.
 */
export async function loadCommissionPeriod(scope: AccessScope, from: Date | null, before: Date) {
  const context = await loadCommissionContext();
  const [inflows, priorTurnover, turnoverCheckpoints] = await Promise.all([
    loadInflowsBetween(scope, from, before),
    loadPriorTurnover(context, from),
    loadTurnoverCheckpoints(context, from, before),
  ]);
  return { context, period: buildCommissionMonth(context.intermediaries, context.bindings, inflows, context.ownInns, { scale: context.scale, priorTurnover, turnoverCheckpoints }) };
}

/** Конечный оборот актуальной версии действует с первого дня следующего месяца. */
async function loadTurnoverCheckpoints(context: CommissionContext, after: Date | null, through: Date) {
  const ids = context.intermediaries.filter((m) => m.category === "STANDARD").map((m) => m.id);
  const checkpoints = new Map<string, TurnoverCheckpoint[]>();
  if (!ids.length) return checkpoints;
  const upper = new Date(Date.UTC(through.getUTCFullYear(), through.getUTCMonth(), 1));
  const lower = after ? new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth() - 1, 1)) : undefined;
  const rows = await prisma.intermediaryCommissionClosing.findMany({
    where: { intermediaryId: { in: ids }, month: { gte: lower, lt: upper } },
    orderBy: [{ month: "asc" }, { version: "desc" }],
    distinct: ["intermediaryId", "month"],
    select: { intermediaryId: true, month: true, report: true },
  });
  for (const row of rows) {
    const from = new Date(Date.UTC(row.month.getUTCFullYear(), row.month.getUTCMonth() + 1, 1));
    if (after && from <= after) continue;
    const turnover = (row.report as { basis?: { closingTurnover?: string | null } }).basis?.closingTurnover;
    if (typeof turnover !== "string") continue;
    const entries = checkpoints.get(row.intermediaryId) ?? [];
    entries.push({ from, turnover: new Decimal(turnover) });
    checkpoints.set(row.intermediaryId, entries);
  }
  return checkpoints;
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
  const [inflows, turnoverCheckpoints] = await Promise.all([
    earliest && earliest >= before ? [] : loadInflowsBetween(UNRESTRICTED_SCOPE, earliest, before),
    loadTurnoverCheckpoints(context, null, before),
  ]);
  return buildCommissionMonth(context.intermediaries, context.bindings, inflows, context.ownInns, { scale: context.scale, turnoverCheckpoints }).turnoverAfter;
}

/** Расчёт за месяц и помесячная динамика комиссий за 12 месяцев до него включительно. */
export async function loadCommissionDashboard(scope: AccessScope, ym: YearMonth) {
  const context = await loadCommissionContext();
  const firstMonth = shiftMonth(ym, -11);
  const [inflows, prior, checkpoints] = await Promise.all([
    loadInflows(scope, firstMonth, ym),
    loadPriorTurnover(context, monthStart(firstMonth)),
    loadTurnoverCheckpoints(context, monthStart(firstMonth), monthStart(shiftMonth(ym, 1))),
  ]);
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(firstMonth, i));
  let priorTurnover = prior;
  const perMonth: Array<{ ym: YearMonth; data: CommissionMonth }> = months.map((m) => {
    const nextStart = monthStart(shiftMonth(m, 1));
    const turnoverCheckpoints = new Map<string, TurnoverCheckpoint[]>();
    for (const [id, entries] of checkpoints) {
      const entry = entries.find((checkpoint) => checkpoint.from.getTime() === nextStart.getTime());
      if (entry) turnoverCheckpoints.set(id, [entry]);
    }
    const data = buildCommissionMonth(context.intermediaries, context.bindings, inflows.filter((op) => sameMonth(op.date, m)), context.ownInns, {
      scale: context.scale,
      priorTurnover,
      turnoverCheckpoints,
    });
    priorTurnover = new Map([...priorTurnover, ...data.turnoverAfter]);
    return { ym: m, data };
  });
  return { context, current: perMonth[perMonth.length - 1].data, trend: perMonth };
}
