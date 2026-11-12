import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { isScopeRestricted, type AccessScope } from "@/lib/access-scope";
import { prisma } from "@/lib/db";
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
  fixedAt?: Date;
  version?: number;
  correctionReason?: string | null;
  basis: {
    openingTurnover: string | null;
    closingTurnover: string | null;
    receipts: Array<{ id: string; date: string; payerName: string | null; purpose: string | null; amount: string; pct: string | null }>;
  };
}

export const commissionMonthDate = (ym: YearMonth) => new Date(Date.UTC(ym.year, ym.month - 1, 1));

export function parseCommissionVersion(value: string): number | null {
  const version = Number(value);
  return /^\d+$/.test(value) && version > 0 && version <= 2147483647 ? version : null;
}

export function serializeCommissionReport(report: IntermediaryReport) {
  return {
    id: report.id, title: report.title, article: report.article, name: report.name,
    lines: report.lines.map((line) => ({ ...line, date: line.date.toISOString(), amount: line.amount.toString() })),
    total: report.total.toString(),
    commission: report.commission?.toString() ?? null,
    commissionPct: report.commissionPct?.toString() ?? null,
    commissionLines: report.commissionLines.map((line) => ({ label: line.label, amount: line.amount?.toString() ?? null })),
    basis: report.basis,
  };
}

type CurrentStoredLine = ReturnType<typeof serializeCommissionReport>["lines"][number];
type LegacyStoredLine = Pick<CurrentStoredLine, "date" | "amount"> & { text: string };
type StoredReport = Omit<ReturnType<typeof serializeCommissionReport>, "lines"> & { lines: Array<CurrentStoredLine | LegacyStoredLine> };

function restoreReportLine(line: CurrentStoredLine | LegacyStoredLine): ReportLine {
  const base = { date: new Date(line.date), amount: new Decimal(line.amount) };
  if ("counterparty" in line) return { ...base, counterparty: line.counterparty, purpose: line.purpose };
  const marker = "\nНазначение платежа: ";
  const split = line.text.indexOf(marker);
  const buyer = split < 0 ? line.text : line.text.slice(0, split);
  return {
    ...base,
    counterparty: buyer.replace(/^Покупатель: /, ""),
    purpose: split < 0 ? null : line.text.slice(split + marker.length),
  };
}

export function commissionReportFingerprint(report: IntermediaryReport): string {
  return createHash("sha256").update(JSON.stringify(serializeCommissionReport(report))).digest("hex");
}

export async function loadFixedCommissionReports(scope: AccessScope, ym: YearMonth, id = "all", version?: number): Promise<IntermediaryReport[]> {
  // Закрытие содержит полный отчёт. Для ограниченной роли его строки могут быть недоступны.
  if (isScopeRestricted(scope) || (id === "all" && version !== undefined)) return [];
  const records = await prisma.intermediaryCommissionClosing.findMany({
    where: { month: commissionMonthDate(ym), ...(id === "all" ? {} : { intermediaryId: id }), version },
    orderBy: { version: "desc" },
    distinct: ["intermediaryId"],
  });
  const decimal = (value: string | null) => value === null ? null : new Decimal(value);
  return records.map(({ report, fixedAt, version, correctionReason }) => {
    const stored = report as StoredReport;
    return {
      ...stored, fixedAt, version, correctionReason,
      lines: stored.lines.map(restoreReportLine),
      total: new Decimal(stored.total),
      commission: decimal(stored.commission),
      commissionPct: decimal(stored.commissionPct),
      commissionLines: stored.commissionLines.map((line) => ({ ...line, amount: decimal(line.amount) })),
    };
  });
}

export async function loadCommissionVersionHistory(scope: AccessScope, ym: YearMonth, id: string) {
  if (isScopeRestricted(scope) || id === "all") return [];
  return prisma.intermediaryCommissionClosing.findMany({
    where: { month: commissionMonthDate(ym), intermediaryId: id },
    orderBy: { version: "desc" },
    select: { version: true, fixedAt: true, correctionReason: true },
  });
}

export async function calculateCommissionCorrection(scope: AccessScope, ym: YearMonth, id: string) {
  const [report] = await calculateIntermediaryReports(scope, ym, id);
  if (!report) return null;
  if (!report.lines.length) {
    const zero = new Decimal(0);
    return { ...report, commission: zero, commissionPct: null, commissionLines: [{ label: "Комиссия итого", amount: zero }] };
  }
  return report;
}

/** Отчёт по одному посреднику или по всем с поступлениями либо сохранённым расчётом. */
export async function loadIntermediaryReports(scope: AccessScope, ym: YearMonth, id: string, version?: number): Promise<IntermediaryReport[]> {
  const fixed = await loadFixedCommissionReports(scope, ym, id, version);
  if (version !== undefined || (id !== "all" && fixed.length)) return fixed;
  const live = await calculateIntermediaryReports(scope, ym, id);
  const fixedIds = new Set(fixed.map((report) => report.id));
  return [...live.filter((report) => !fixedIds.has(report.id)), ...fixed].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function calculateIntermediaryReports(scope: AccessScope, ym: YearMonth, id: string): Promise<IntermediaryReport[]> {
  const context = await loadCommissionContext();
  const [inflows, priorTurnover] = await Promise.all([loadInflows(scope, ym, ym), loadPriorTurnover(context, new Date(Date.UTC(ym.year, ym.month - 1, 1)))]);
  const month = buildCommissionMonth(context.intermediaries, context.bindings, inflows, context.ownInns, { scale: context.scale, priorTurnover });
  return month.rows
    .filter((r) => (id === "all" ? r.inflows.some((op) => op.confirmed) : r.intermediary.id === id))
    .map((r) => ({
      ...commissionView(r.parts, rateOn(r.intermediary, new Date(Date.UTC(ym.year, ym.month, 0))), r.commission),
      id: r.intermediary.id,
      name: r.intermediary.name,
      title: reportTitle(ym.year, ym.month),
      article: `Статья движения денег: ${r.intermediary.reportName || r.intermediary.name}`,
      lines: reportLines(r.inflows.filter((op) => op.confirmed)),
      total: r.confirmedTotal,
      commission: r.commission,
      basis: {
        openingTurnover: r.intermediary.category === "STANDARD" ? priorTurnover.get(r.intermediary.id)?.toString() ?? "0" : null,
        closingTurnover: month.turnoverAfter.get(r.intermediary.id)?.toString() ?? null,
        receipts: r.inflows.filter((op) => op.confirmed).map((op) => ({
          id: op.id, date: op.date.toISOString(), payerName: op.payerName, purpose: op.purpose,
          amount: op.amount.toString(), pct: op.appliedPct?.toString() ?? null,
        })).sort((a, b) => a.id.localeCompare(b.id)),
      },
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
