import Decimal from "decimal.js";

/**
 * Система налогообложения организации и её налоги со ставками по датам
 * (справочник «Организации и ИП» → «Налоги и ставки»). Ставка налога на
 * дату — запись с самой поздней датой начала действия не позже этой даты;
 * новая запись заменяет прежнюю со своей даты, история сохраняется.
 */
export type TaxSystem = "osn" | "usn_income" | "usn_income_expense" | "ausn_income" | "ausn_income_expense" | "eshn" | "psn";

export const TAX_SYSTEM_OPTIONS: Array<{ value: TaxSystem; label: string }> = [
  { value: "osn", label: "ОСН (общая система)" },
  { value: "usn_income", label: "УСН «доходы»" },
  { value: "usn_income_expense", label: "УСН «доходы минус расходы»" },
  { value: "ausn_income", label: "АУСН «доходы»" },
  { value: "ausn_income_expense", label: "АУСН «доходы минус расходы»" },
  { value: "eshn", label: "ЕСХН" },
  { value: "psn", label: "Патент (ПСН, только ИП)" },
];

export type TaxKind = "profit" | "vat" | "usn" | "ausn" | "eshn" | "property" | "insurance" | "injury" | "ip_insurance_fixed" | "ip_insurance_income";

export const TAX_KIND_LABELS: Record<TaxKind, string> = {
  profit: "Налог на прибыль",
  vat: "НДС",
  usn: "Налог по УСН",
  ausn: "Налог по АУСН",
  eshn: "ЕСХН",
  property: "Налог на имущество",
  insurance: "Страховые взносы — единый тариф (вместо общих правил)",
  injury: "Взносы на травматизм",
  ip_insurance_fixed: "Страховые взносы ИП за себя — фиксированные, ₽ в год",
  ip_insurance_income: "Страховые взносы ИП за себя — % с дохода свыше порога",
};

/** Фиксированные взносы ИП за себя: сумма за год (п. 1.2 ст. 430 НК РФ), уплата до 28 декабря. */
export const IP_FIXED_KIND: TaxKind = "ip_insurance_fixed";
export const IP_FIXED_BY_YEAR: Record<number, number> = { 2024: 49500, 2025: 53658, 2026: 57390, 2027: 61154 };
/** Налоги, у которых вместо ставки — сумма за год. */
export const FIXED_AMOUNT_KINDS: ReadonlySet<string> = new Set(["ip_insurance_fixed"]);
/** Налоги только для ИП. */
export const SOLE_PROPRIETOR_KINDS: ReadonlySet<string> = new Set(["ip_insurance_fixed", "ip_insurance_income"]);

/** Взносы ИП за себя с дохода свыше порога: только у ИП; порог дохода обязателен, максимум за год — по желанию. */
export const IP_INCOME_KIND: TaxKind = "ip_insurance_income";
export const IP_INCOME_THRESHOLD = 300000;
/** Максимум взносов 1 % за год (ст. 430 НК РФ). Для других лет — вручную. */
export const IP_INCOME_MAX_BY_YEAR: Record<number, number> = { 2024: 277571, 2025: 300888, 2026: 321818, 2027: 343340 };

export const TAX_KINDS = Object.keys(TAX_KIND_LABELS) as TaxKind[];

/** Стандартные ставки по системе налогообложения — для кнопки «Заполнить стандартными ставками». */
export const STANDARD_RATES: Record<TaxSystem, Array<{ kind: TaxKind; ratePct: number }>> = {
  osn: [
    { kind: "profit", ratePct: 25 },
    { kind: "vat", ratePct: 22 },
  ],
  usn_income: [{ kind: "usn", ratePct: 6 }],
  usn_income_expense: [{ kind: "usn", ratePct: 15 }],
  ausn_income: [{ kind: "ausn", ratePct: 8 }],
  ausn_income_expense: [{ kind: "ausn", ratePct: 20 }],
  eshn: [{ kind: "eshn", ratePct: 6 }],
  psn: [],
};

export function isTaxSystem(value: string): value is TaxSystem {
  return TAX_SYSTEM_OPTIONS.some((o) => o.value === value);
}

export function isTaxKind(value: string): value is TaxKind {
  return (TAX_KINDS as string[]).includes(value);
}

export interface TaxRateRecord {
  taxKind: string;
  ratePct: Decimal | number | string | { toString(): string };
  validFrom: Date;
  thresholdAmount?: Decimal | number | string | { toString(): string } | null;
  maxAmount?: Decimal | number | string | { toString(): string } | null;
  fixedAmount?: Decimal | number | string | { toString(): string } | null;
}

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Запись ставки, действующая на дату, или null. */
export function recordAt<T extends TaxRateRecord>(rates: T[], kind: TaxKind, date: Date): T | null {
  const day = utcDay(date);
  let best: T | null = null;
  for (const r of rates) {
    if (r.taxKind !== kind || utcDay(r.validFrom) > day) continue;
    if (!best || utcDay(r.validFrom) > utcDay(best.validFrom)) best = r;
  }
  return best;
}

/** Ставка налога на дату (%) или null, если на эту дату ставки нет. */
export function rateAt(rates: TaxRateRecord[], kind: TaxKind, date: Date): Decimal | null {
  const best = recordAt(rates, kind, date);
  return best ? new Decimal(best.ratePct.toString()) : null;
}

/** Взносы ИП с дохода свыше порога на дату: ставка, порог и максимум за год (null — без максимума). */
export function ipIncomeInsuranceAt(rates: TaxRateRecord[], date: Date): { ratePct: Decimal; threshold: Decimal; max: Decimal | null } | null {
  const r = recordAt(rates, IP_INCOME_KIND, date);
  if (!r) return null;
  return {
    ratePct: new Decimal(r.ratePct.toString()),
    threshold: new Decimal((r.thresholdAmount ?? IP_INCOME_THRESHOLD).toString()),
    max: r.maxAmount === null || r.maxAmount === undefined ? null : new Decimal(r.maxAmount.toString()),
  };
}

/** Фиксированные взносы ИП за год, действующие на дату, или null. */
export function ipFixedInsuranceAt(rates: TaxRateRecord[], date: Date): Decimal | null {
  const r = recordAt(rates, IP_FIXED_KIND, date);
  return r && r.fixedAmount !== null && r.fixedAmount !== undefined ? new Decimal(r.fixedAmount.toString()) : null;
}

/** Дата окончания действия записи — день перед следующей записью того же налога; null — действует сейчас. */
export function validUntil(rates: TaxRateRecord[], record: TaxRateRecord): Date | null {
  const next = rates
    .filter((r) => r.taxKind === record.taxKind && utcDay(r.validFrom) > utcDay(record.validFrom))
    .sort((a, b) => utcDay(a.validFrom) - utcDay(b.validFrom))[0];
  return next ? new Date(utcDay(next.validFrom) - 86_400_000) : null;
}

export interface TaxRateForm {
  taxKind: TaxKind;
  ratePct: Decimal;
  validFrom: Date;
  comment: string | null;
  thresholdAmount: Decimal | null;
  maxAmount: Decimal | null;
  fixedAmount: Decimal | null;
}

function parseAmount(raw: string | undefined): Decimal | null | "invalid" {
  const cleaned = (raw ?? "").replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? new Decimal(cleaned) : "invalid";
}

export function parseTaxRateForm(raw: {
  taxKind?: string;
  ratePct?: string;
  validFrom?: string;
  comment?: string;
  thresholdAmount?: string;
  maxAmount?: string;
  fixedAmount?: string;
}): { value: TaxRateForm } | { error: string } {
  const taxKind = (raw.taxKind ?? "").trim();
  if (!isTaxKind(taxKind)) return { error: "Выберите налог" };
  // Fixed contributions are an amount a year, not a percentage.
  let fixedAmount: Decimal | null = null;
  if (FIXED_AMOUNT_KINDS.has(taxKind)) {
    const amount = parseAmount(raw.fixedAmount);
    if (amount === null || amount === "invalid" || amount.lessThanOrEqualTo(0)) return { error: "Укажите сумму фиксированных взносов за год в рублях" };
    fixedAmount = amount;
  }
  const rateRaw = FIXED_AMOUNT_KINDS.has(taxKind) ? "0" : (raw.ratePct ?? "").replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(rateRaw) || Number(rateRaw) > 100) return { error: "Ставка — число от 0 до 100 (до трёх знаков после запятой)" };
  const date = (raw.validFrom ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const validFrom = date ? new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]))) : null;
  if (!validFrom || Number.isNaN(validFrom.getTime()) || validFrom.getUTCDate() !== Number(date![3])) return { error: "Укажите дату начала действия ставки" };
  const comment = (raw.comment ?? "").trim() || null;
  // The threshold and the annual maximum belong to the sole proprietor's contributions only.
  let thresholdAmount: Decimal | null = null;
  let maxAmount: Decimal | null = null;
  if (taxKind === IP_INCOME_KIND) {
    const threshold = parseAmount(raw.thresholdAmount);
    const max = parseAmount(raw.maxAmount);
    if (threshold === null || threshold === "invalid") return { error: "Укажите порог дохода в рублях (например, 300 000)" };
    if (max === "invalid" || (max !== null && max.lessThanOrEqualTo(0))) return { error: "Максимум взносов за год — положительная сумма в рублях или пусто" };
    thresholdAmount = threshold;
    maxAmount = max;
  }
  return { value: { taxKind, ratePct: new Decimal(rateRaw), validFrom, comment, thresholdAmount, maxAmount, fixedAmount } };
}

export interface StandardRate {
  kind: TaxKind;
  ratePct: number;
  thresholdAmount?: number;
  maxAmount?: number | null;
  fixedAmount?: number | null;
}

/**
 * Какие стандартные ставки ещё не заведены (по налогу нет ни одной записи).
 * У ИП (кроме АУСН — там взносов за себя нет) добавляются фиксированные
 * взносы за себя и взносы 1 % с дохода свыше 300 000 ₽ — суммы года, с
 * которого действуют ставки (для лет, которых нет в таблицах, фиксированные
 * взносы не предлагаются, а максимум 1 % остаётся пустым).
 */
export function missingStandardRates(
  system: TaxSystem,
  existing: TaxRateRecord[],
  organizationType: string = "LEGAL_ENTITY",
  year: number = new Date().getFullYear(),
): StandardRate[] {
  const standard: StandardRate[] = [...STANDARD_RATES[system]];
  if (organizationType === "SOLE_PROPRIETOR" && system !== "ausn_income" && system !== "ausn_income_expense") {
    const fixed = IP_FIXED_BY_YEAR[year];
    if (fixed) standard.push({ kind: IP_FIXED_KIND, ratePct: 0, fixedAmount: fixed });
    standard.push({ kind: IP_INCOME_KIND, ratePct: 1, thresholdAmount: IP_INCOME_THRESHOLD, maxAmount: IP_INCOME_MAX_BY_YEAR[year] ?? null });
  }
  return standard.filter((s) => !existing.some((r) => r.taxKind === s.kind));
}

/** Подпись ставки для экрана: «1% с дохода свыше 300 000 ₽, не более 321 818 ₽ в год». */
export function describeRate(r: TaxRateRecord, format: (n: Decimal) => string): string {
  if (FIXED_AMOUNT_KINDS.has(r.taxKind)) return `${format(new Decimal((r.fixedAmount ?? 0).toString()))} в год`;
  const pct = `${new Decimal(r.ratePct.toString()).toString().replace(".", ",")}%`;
  if (r.taxKind !== IP_INCOME_KIND) return pct;
  const threshold = format(new Decimal((r.thresholdAmount ?? IP_INCOME_THRESHOLD).toString()));
  const max = r.maxAmount === null || r.maxAmount === undefined ? "" : `, не более ${format(new Decimal(r.maxAmount.toString()))} в год`;
  return `${pct} с дохода свыше ${threshold}${max}`;
}
