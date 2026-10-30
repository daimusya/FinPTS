import type Decimal from "decimal.js";
import type { AccessScope } from "@/lib/access-scope";
import { formatNumber } from "@/lib/money";
import { buildCommissionMonth, rateOn, reportLines, reportTitle, type RatePart, type ReportLine } from "./commissions";
import { loadCommissionContext, loadInflows, loadPriorTurnover, type YearMonth } from "./load";

export interface IntermediaryReport {
  id: string;
  title: string;
  /** «Статья движения денег: Харламова Светлана». */
  article: string;
  lines: ReportLine[];
  total: Decimal;
  commission: Decimal | null;
  commissionPct: Decimal | null;
  /** Строки комиссии: по одной на ставку (ставка менялась в этом месяце — несколько). */
  commissionLines: Array<{ label: string; amount: Decimal | null }>;
  /** Для имени файла. */
  name: string;
}

/** Отчёты за месяц: по одному посреднику (id) или по всем с поступлениями (id = "all"). */
export async function loadIntermediaryReports(scope: AccessScope, ym: YearMonth, id: string): Promise<IntermediaryReport[]> {
  const context = await loadCommissionContext();
  const [inflows, priorTurnover] = await Promise.all([loadInflows(scope, ym, ym), loadPriorTurnover(context, new Date(Date.UTC(ym.year, ym.month - 1, 1)))]);
  const month = buildCommissionMonth(context.intermediaries, context.bindings, inflows, context.ownInns, { scale: context.scale, priorTurnover });
  return month.rows
    .filter((r) => (id === "all" ? r.inflows.length > 0 : r.intermediary.id === id))
    .map((r) => ({
      ...commissionView(r.parts, rateOn(r.intermediary, new Date(Date.UTC(ym.year, ym.month, 0))), r.commission),
      id: r.intermediary.id,
      name: r.intermediary.name,
      title: reportTitle(ym.year, ym.month),
      article: `Статья движения денег: ${r.intermediary.reportName || r.intermediary.name}`,
      lines: reportLines(r.inflows),
      total: r.total,
      commission: r.commission,
    }));
}

const ddmm = (d: Date) => d.toISOString().slice(5, 10).split("-").reverse().join(".");

/** Одна ставка — строка «Комиссия 20%», как в шаблоне; несколько — строка на каждую и итог. */
export function commissionView(parts: RatePart[], monthEndPct: Decimal | null, commission: Decimal | null) {
  if (parts.length <= 1) {
    const pct = parts.length ? parts[0].pct : monthEndPct;
    const basis = parts[0]?.basis ? ` (${parts[0].basis})` : "";
    return { commissionPct: pct, commissionLines: [{ label: `${commissionLabel(pct)}${basis}`, amount: commission }] };
  }
  return {
    commissionPct: null,
    commissionLines: [
      ...parts.map((p) => ({ label: `${commissionLabel(p.pct)} с ${ddmm(p.from)} по ${ddmm(p.to)} (от ${formatNumber(p.total)}${p.basis ? `; ${p.basis}` : ""})`, amount: p.commission })),
      { label: "Комиссия итого", amount: commission },
    ],
  };
}

export const commissionLabel = (pct: Decimal | null) =>
  pct === null ? "Комиссия (ставка не задана)" : `Комиссия ${pct.toString().replace(".", ",")}%`;
