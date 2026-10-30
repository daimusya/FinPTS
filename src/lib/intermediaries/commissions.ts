import Decimal from "decimal.js";
import { payerKey, resolvePayers, type MatcherBinding, type MatcherIntermediary, type PayerMatch } from "./matching";
import { DEFAULT_SCALE, scaleBasis, scalePct, type ScaleTier } from "./standard-scale";

/** Поступление из «Банк и касса» для расчёта комиссий. */
export interface InflowRow {
  id: string;
  date: Date;
  amount: Decimal;
  purpose: string | null;
  payerInn: string | null;
  payerName: string | null;
}

export interface IntermediaryInfo extends MatcherIntermediary {
  name: string;
  reportName: string | null;
  /** ВИП — ставка по согласованию (с изменениями по датам); Стандарт — по шкале от оборота накопительным итогом. */
  category: "VIP" | "STANDARD";
  /** «Стандарт»: с какого дня копится оборот; null — с первой оплаты. */
  turnoverFrom: Date | null;
  /** %, null — ставка не задана. Если ставку меняли — ставка до первого изменения. */
  commissionPct: Decimal | null;
  /** Изменения ставки с даты, по возрастанию даты. */
  rateChanges: RateChange[];
}

export interface RateChange {
  from: Date;
  pct: Decimal;
}

/** Ставка на дату поступления: последнее изменение не позже этой даты, иначе начальная. */
export function rateOn(m: Pick<IntermediaryInfo, "commissionPct" | "rateChanges">, date: Date): Decimal | null {
  let pct = m.commissionPct;
  for (const change of m.rateChanges) {
    if (change.from.getTime() > date.getTime()) break;
    pct = change.pct;
  }
  return pct;
}

/** Поступления посредника, к которым применялась одна ставка (подряд по датам). */
export interface RatePart {
  pct: Decimal | null;
  from: Date;
  to: Date;
  total: Decimal;
  commission: Decimal | null;
  /** Для «Стандарта» — ступень шкалы и накопленный оборот. */
  basis?: string;
}

/** Есть ли у посредника ставка на дату (у «Стандарта» — по шкале, с даты начала оборота). */
export const hasRateOn = (m: Pick<IntermediaryInfo, "category" | "turnoverFrom" | "commissionPct" | "rateChanges">, date: Date) =>
  m.category === "STANDARD" ? !m.turnoverFrom || m.turnoverFrom <= date : rateOn(m, date) !== null;

export interface MatchedInflow extends InflowRow {
  /** true — ИНН закреплён вручную; false — найдено по названию, нужно проверить. */
  confirmed: boolean;
  clientName: string | null;
  /** Ставка, по которой посчитана эта оплата (null — без комиссии). */
  appliedPct?: Decimal | null;
}

type RatedInflow = InflowRow & { appliedPct?: Decimal | null };

export interface IntermediaryMonth {
  intermediary: IntermediaryInfo;
  inflows: MatchedInflow[];
  total: Decimal;
  /** null — ставка не задана. */
  commission: Decimal | null;
  /** Ставки за период: одна часть, если ставка не менялась. */
  parts: RatePart[];
  unconfirmed: number;
}

/** Плательщик со всеми его поступлениями за период (для списков «проверить» и «без посредника»). */
export interface PayerGroup {
  key: string;
  inn: string | null;
  name: string;
  count: number;
  total: Decimal;
  match: PayerMatch;
}

export interface CommissionMonth {
  rows: IntermediaryMonth[];
  /** Найдено по названию — ждёт подтверждения ИНН. */
  toReview: PayerGroup[];
  /** Название подходит к организациям разных посредников. */
  ambiguous: PayerGroup[];
  /** Поступления, не отнесённые ни к кому (кроме исключённых и своих переводов). */
  unassigned: PayerGroup[];
  totalInflow: Decimal;
  totalCommission: Decimal;
  /** «Стандарт»: накопленный оборот после последней оплаты — начало для следующего периода. */
  turnoverAfter: Map<string, Decimal>;
}

export function commissionOf(total: Decimal, pct: Decimal | null): Decimal | null {
  return pct === null ? null : total.times(pct).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Переводы между своими счетами — не поступления от клиентов. */
const OWN_TRANSFER = /собственных средств|между своими счетами|перевод средств между счетами/i;

export interface CommissionOptions {
  /** Шкала «Стандарта»; по умолчанию 5/10/15%. */
  scale?: ScaleTier[];
  /** «Стандарт»: оборот, накопленный до первой оплаты этих поступлений (по id посредника). */
  priorTurnover?: Map<string, Decimal>;
}

/** Расчёт за месяц или любой период: inflows — поступления этого периода. */
export function buildCommissionMonth(
  intermediaries: IntermediaryInfo[],
  bindings: MatcherBinding[],
  inflows: InflowRow[],
  ownInns: Set<string>,
  options: CommissionOptions = {},
): CommissionMonth {
  const scale = options.scale ?? DEFAULT_SCALE;
  const relevant = inflows.filter((op) => !(op.payerInn && ownInns.has(op.payerInn)) && !OWN_TRANSFER.test(op.purpose ?? ""));
  const matches = resolvePayers(intermediaries, bindings, relevant.map((op) => ({ inn: op.payerInn, name: op.payerName })));

  const rows = new Map<string, IntermediaryMonth>(
    intermediaries.map((m) => [m.id, { intermediary: m, inflows: [], total: new Decimal(0), commission: null, parts: [], unconfirmed: 0 }]),
  );
  const groups = new Map<string, PayerGroup>();
  let totalInflow = new Decimal(0);
  const turnoverAfter = new Map<string, Decimal>();

  for (const op of relevant) {
    const key = payerKey({ inn: op.payerInn, name: op.payerName });
    const match = matches.get(key) ?? { kind: "none" };
    if (match.kind === "inn" || match.kind === "name") {
      const row = rows.get(match.intermediaryId);
      if (!row) continue;
      row.inflows.push({ ...op, confirmed: match.kind === "inn", clientName: match.kind === "name" ? match.clientName : null });
      row.total = row.total.plus(op.amount);
      if (match.kind === "name") row.unconfirmed += 1;
      totalInflow = totalInflow.plus(op.amount);
    }
    if (match.kind === "inn" || match.kind === "excluded") continue;
    const group = groups.get(key) ?? { key, inn: op.payerInn, name: op.payerName ?? "без наименования", count: 0, total: new Decimal(0), match };
    group.count += 1;
    group.total = group.total.plus(op.amount);
    groups.set(key, group);
  }

  let totalCommission = new Decimal(0);
  for (const row of rows.values()) {
    row.inflows.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.payerName ?? "").localeCompare(b.payerName ?? "", "ru"));
    if (row.intermediary.category === "STANDARD") {
      const prior = options.priorTurnover?.get(row.intermediary.id) ?? new Decimal(0);
      const { parts, turnover } = standardParts(row.intermediary, row.inflows, scale, prior);
      row.parts = parts;
      turnoverAfter.set(row.intermediary.id, turnover);
    } else {
      row.parts = rateParts(row.intermediary, row.inflows);
    }
    const rated = row.parts.filter((p) => p.commission !== null);
    row.commission = rated.length ? rated.reduce((sum, p) => sum.plus(p.commission!), new Decimal(0)) : null;
    if (row.commission) totalCommission = totalCommission.plus(row.commission);
  }

  const byTotal = (a: PayerGroup, b: PayerGroup) => b.total.comparedTo(a.total);
  const all = [...groups.values()];
  return {
    rows: [...rows.values()],
    toReview: all.filter((g) => g.match.kind === "name").sort(byTotal),
    ambiguous: all.filter((g) => g.match.kind === "ambiguous").sort(byTotal),
    unassigned: all.filter((g) => g.match.kind === "none").sort(byTotal),
    totalInflow,
    totalCommission,
    turnoverAfter,
  };
}

/** Подпись оплат «Стандарта» до даты начала оборота. */
export const BEFORE_TURNOVER = "до начала оборота — без комиссии";

/** Порядок оплат одного дня для накопительного итога — как загружены (по id), чтобы расчёт не зависел от сортировки на экране. */
const cumulativeOrder = (a: InflowRow, b: InflowRow) => a.date.getTime() - b.date.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * «Стандарт»: каждая оплата целиком — по ступени, в которую попал
 * накопленный оборот вместе с ней. Оплаты до даты начала оборота в него не
 * входят и комиссии по шкале не дают.
 */
export function standardParts(
  m: Pick<IntermediaryInfo, "turnoverFrom">,
  inflows: RatedInflow[],
  scale: ScaleTier[],
  prior: Decimal,
): { parts: RatePart[]; turnover: Decimal } {
  let turnover = prior;
  const parts: RatePart[] = [];
  for (const op of [...inflows].sort(cumulativeOrder)) {
    const counted = !m.turnoverFrom || op.date >= m.turnoverFrom;
    if (counted) turnover = turnover.plus(op.amount);
    const pct = counted ? scalePct(scale, turnover) : null;
    op.appliedPct = pct;
    const last = parts[parts.length - 1];
    if (last && (last.pct === null ? pct === null : pct !== null && last.pct.equals(pct))) {
      last.to = op.date;
      last.total = last.total.plus(op.amount);
    } else {
      parts.push({ pct, from: op.date, to: op.date, total: op.amount, commission: null });
    }
    parts[parts.length - 1].basis = counted ? scaleBasis(scale, turnover, op.date) : BEFORE_TURNOVER;
  }
  for (const part of parts) part.commission = commissionOf(part.total, part.pct);
  return { parts, turnover };
}

/**
 * Поступления (по возрастанию даты) по ставкам: комиссия считается от суммы
 * каждой части — при одной ставке это та же «итог × ставка», что в шаблоне.
 */
export function rateParts(m: Pick<IntermediaryInfo, "commissionPct" | "rateChanges">, inflows: RatedInflow[]): RatePart[] {
  const parts: RatePart[] = [];
  for (const op of inflows) {
    const pct = rateOn(m, op.date);
    op.appliedPct = pct;
    const last = parts[parts.length - 1];
    if (last && (last.pct === null ? pct === null : pct !== null && last.pct.equals(pct))) {
      last.to = op.date;
      last.total = last.total.plus(op.amount);
    } else {
      parts.push({ pct, from: op.date, to: op.date, total: op.amount, commission: null });
    }
  }
  for (const part of parts) part.commission = commissionOf(part.total, part.pct);
  return parts;
}

// ---------------------------------------------------------------------------
// Строки печатного отчёта — как в шаблоне: дата, «Покупатель: …», сумма;
// поступления одного плательщика за день складываются в одну строку.
// ---------------------------------------------------------------------------

const FORMS: Array<[RegExp, string]> = [
  [/ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ/gi, "ООО"],
  [/ЗАКРЫТОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО/gi, "ЗАО"],
  [/НЕПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО/gi, "АО"],
  [/ПУБЛИЧНОЕ АКЦИОНЕРНОЕ ОБЩЕСТВО/gi, "ПАО"],
  [/АКЦИОНЕРНОЕ ОБЩЕСТВО/gi, "АО"],
  [/АВТОНОМНАЯ НЕКОММЕРЧЕСКАЯ ОРГАНИЗАЦИЯ/gi, "АНО"],
  [/ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ/gi, "ИП"],
];

/** «ООО "ПТФ "КОНСИС"» → «ПТФ КОНСИС ООО», как в отчётах 1С. */
export function reportPayerName(raw: string | null): string {
  if (!raw) return "без наименования";
  let name = raw;
  for (const [re, short] of FORMS) name = name.replace(re, short);
  name = name.replace(/СПЕЦИАЛИЗИРОВАННЫЙ ЗАСТРОЙЩИК/gi, "СЗ").replace(/[«»"“”„]/g, " ");
  const form = name.match(/^\s*(ООО|ЗАО|ПАО|АО|АНО|ИП)(?![А-ЯЁа-яё])/i)?.[1]?.toUpperCase() ?? null;
  const ipSuffix = /\(ИП\)\s*$/i.test(name);
  let body = (form ? name.replace(/^\s*(ООО|ЗАО|ПАО|АО|АНО|ИП)/i, "") : name).replace(/\(ИП\)\s*$/i, "");
  body = body.replace(/\s+/g, " ").trim();
  const suffix = form ?? (ipSuffix ? "ИП" : null);
  if (suffix !== "ИП") body = body.toUpperCase();
  return suffix ? `${body} ${suffix}` : body;
}

export interface ReportLine {
  date: Date;
  text: string;
  amount: Decimal;
}

export function reportLines(inflows: InflowRow[]): ReportLine[] {
  const lines = new Map<string, ReportLine>();
  for (const op of inflows) {
    const text = `Покупатель: ${reportPayerName(op.payerName)}`;
    const key = `${op.date.toISOString().slice(0, 10)}|${op.payerInn ?? text}`;
    const line = lines.get(key);
    if (line) line.amount = line.amount.plus(op.amount);
    else lines.set(key, { date: op.date, text, amount: op.amount });
  }
  return [...lines.values()].sort((a, b) => a.date.getTime() - b.date.getTime() || a.text.localeCompare(b.text, "ru"));
}

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/** «Анализ поступлений и платежей за Сентябрь 2026 г.» */
export function reportTitle(year: number, month: number): string {
  return `Анализ поступлений и платежей за ${MONTHS[month - 1]} ${year} г.`;
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month - 1]} ${year}`;
}
