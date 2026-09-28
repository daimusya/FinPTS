import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import type { PnlType } from "./pnl";
import { linkedFlowEffect } from "./balance-lines";
import { depreciationSchedule, interestSchedule, type DebtEvent, type MonthCharge } from "./non-cash";

export interface NonCashItem {
  kind: "depreciation" | "interest";
  id: string;
  name: string;
  organizationId: string;
  /** Подразделение основного средства; у займов — null. */
  departmentId: string | null;
  pnlArticle: { id: string; name: string; type: PnlType };
  schedule: MonthCharge[];
}

/**
 * Амортизация по реестру «Основные средства» и проценты по реестру «Займы и
 * кредиты» помесячно до даты until. Архивные записи тоже считаются — это
 * история. Остаток долга по займу — операции по статьям ДДС, привязанным к
 * статье баланса займа (кроме переводов), и балансовые операции по ней, без
 * учёта фильтров отчёта: долг один, как бы ни смотрели отчёт.
 */
export async function loadNonCashCharges(until: Date, organizationIds: string[] | null): Promise<NonCashItem[]> {
  const orgWhere = organizationIds ? { organizationId: { in: organizationIds } } : {};
  const [assets, loans] = await Promise.all([
    prisma.fixedAsset.findMany({ where: { ...orgWhere, commissioningDate: { lt: until } }, include: { pnlArticle: true } }),
    prisma.creditAgreement.findMany({ where: { ...orgWhere, startDate: { lte: until } }, include: { pnlArticle: true } }),
  ]);

  const items: NonCashItem[] = assets.map((a) => ({
    kind: "depreciation",
    id: a.id,
    name: a.name,
    organizationId: a.organizationId,
    departmentId: a.departmentId,
    pnlArticle: { id: a.pnlArticle.id, name: a.pnlArticle.name, type: a.pnlArticle.type as PnlType },
    schedule: depreciationSchedule(a),
  }));

  if (loans.length > 0) {
    const articleIds = loans.map((l) => l.balanceArticleId);
    const [flows, entries] = await Promise.all([
      prisma.bankTransaction.findMany({
        where: { isTransfer: false, operationDate: { lte: until }, cashFlowArticle: { balanceArticleId: { in: articleIds } } },
        select: { amount: true, direction: true, operationDate: true, cashFlowArticle: { select: { balanceArticleId: true } } },
      }),
      prisma.balanceEntry.findMany({
        where: { balanceArticleId: { in: articleIds }, date: { lte: until } },
        select: { balanceArticleId: true, amount: true, date: true },
      }),
    ]);
    const events = new Map<string, DebtEvent[]>(articleIds.map((id) => [id, []]));
    for (const f of flows) {
      events.get(f.cashFlowArticle!.balanceArticleId!)?.push({ date: f.operationDate, delta: linkedFlowEffect("LIABILITY", f.direction, toDecimal(f.amount)) });
    }
    for (const e of entries) events.get(e.balanceArticleId)?.push({ date: e.date, delta: toDecimal(e.amount) });
    for (const l of loans) {
      items.push({
        kind: "interest",
        id: l.id,
        name: l.name,
        organizationId: l.organizationId,
        departmentId: null,
        pnlArticle: { id: l.pnlArticle.id, name: l.pnlArticle.name, type: l.pnlArticle.type as PnlType },
        schedule: interestSchedule(l, events.get(l.balanceArticleId) ?? [], until),
      });
    }
  }
  return items;
}

/** Пересечение фильтра по организации и ограничения доступа: null — все организации. */
export function organizationFilter(organizationId: string | undefined, scopeIds: string[] | null): string[] | null {
  if (organizationId) return scopeIds && !scopeIds.includes(organizationId) ? [] : [organizationId];
  return scopeIds;
}
