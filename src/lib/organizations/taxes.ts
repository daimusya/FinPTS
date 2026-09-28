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

export type TaxKind = "profit" | "vat" | "usn" | "ausn" | "eshn" | "property" | "insurance" | "injury";

export const TAX_KIND_LABELS: Record<TaxKind, string> = {
  profit: "Налог на прибыль",
  vat: "НДС",
  usn: "Налог по УСН",
  ausn: "Налог по АУСН",
  eshn: "ЕСХН",
  property: "Налог на имущество",
  insurance: "Страховые взносы — единый тариф (вместо общих правил)",
  injury: "Взносы на травматизм",
};

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
  ratePct: Decimal | number | string;
  validFrom: Date;
}

const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Ставка налога на дату (%) или null, если на эту дату ставки нет. */
export function rateAt(rates: TaxRateRecord[], kind: TaxKind, date: Date): Decimal | null {
  const day = utcDay(date);
  let best: TaxRateRecord | null = null;
  for (const r of rates) {
    if (r.taxKind !== kind || utcDay(r.validFrom) > day) continue;
    if (!best || utcDay(r.validFrom) > utcDay(best.validFrom)) best = r;
  }
  return best ? new Decimal(best.ratePct.toString()) : null;
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
}

export function parseTaxRateForm(raw: { taxKind?: string; ratePct?: string; validFrom?: string; comment?: string }): { value: TaxRateForm } | { error: string } {
  const taxKind = (raw.taxKind ?? "").trim();
  if (!isTaxKind(taxKind)) return { error: "Выберите налог" };
  const rateRaw = (raw.ratePct ?? "").replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(rateRaw) || Number(rateRaw) > 100) return { error: "Ставка — число от 0 до 100 (до трёх знаков после запятой)" };
  const date = (raw.validFrom ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const validFrom = date ? new Date(Date.UTC(Number(date[1]), Number(date[2]) - 1, Number(date[3]))) : null;
  if (!validFrom || Number.isNaN(validFrom.getTime()) || validFrom.getUTCDate() !== Number(date![3])) return { error: "Укажите дату начала действия ставки" };
  const comment = (raw.comment ?? "").trim() || null;
  return { value: { taxKind, ratePct: new Decimal(rateRaw), validFrom, comment } };
}

/** Какие стандартные ставки ещё не заведены (по налогу нет ни одной записи). */
export function missingStandardRates(system: TaxSystem, existing: TaxRateRecord[]): Array<{ kind: TaxKind; ratePct: number }> {
  return STANDARD_RATES[system].filter((s) => !existing.some((r) => r.taxKind === s.kind));
}
