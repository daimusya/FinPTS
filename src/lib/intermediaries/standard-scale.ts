import Decimal from "decimal.js";

/**
 * Шкала категории «Стандарт»: ставка зависит от оборота посредника
 * накопительным итогом (с даты в его карточке). Каждая оплата целиком идёт
 * по ступени, в которую попал итог вместе с ней; прошлые оплаты при переходе
 * порога не пересчитываются. Ступень «до» включает границу: при 50 000 — ещё 5%. Хранится в настройках системы
 * (intermediary_standard_scale), правится в справочнике посредников.
 * Чистые функции — проверяются тестами.
 */
export interface ScaleTier {
  /** Верхняя граница оборота включительно; null — без ограничения (последняя ступень). */
  upTo: Decimal | null;
  pct: Decimal;
}

export const SCALE_SETTING_KEY = "intermediary_standard_scale";

export const DEFAULT_SCALE: ScaleTier[] = [
  { upTo: new Decimal(50000), pct: new Decimal(5) },
  { upTo: new Decimal(150000), pct: new Decimal(10) },
  { upTo: null, pct: new Decimal(15) },
];

export function scalePct(scale: ScaleTier[], turnover: Decimal): Decimal {
  const tier = scale.find((t) => t.upTo === null || turnover.lte(t.upTo)) ?? scale[scale.length - 1];
  return tier.pct;
}

const money = (v: Decimal) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v.toNumber());

/** «до 50 000», «от 50 000 до 150 000», «более 150 000». */
export function tierLabel(scale: ScaleTier[], index: number): string {
  const tier = scale[index];
  const prev = index > 0 ? scale[index - 1].upTo : null;
  if (tier.upTo === null) return prev ? `более ${money(prev)}` : "любой оборот";
  return prev ? `от ${money(prev)} до ${money(tier.upTo)}` : `до ${money(tier.upTo)}`;
}

/** «ступень от 50 000 до 150 000, накоплено к 12.09.2026 — 70 000». */
export function scaleBasis(scale: ScaleTier[], cumulative: Decimal, asOf: Date): string {
  const index = scale.findIndex((t) => t.upTo === null || cumulative.lte(t.upTo));
  const date = asOf.toISOString().slice(0, 10).split("-").reverse().join(".");
  return `ступень ${tierLabel(scale, index === -1 ? scale.length - 1 : index)}, накоплено к ${date} — ${money(cumulative)}`;
}

/** «5% / 10% / 15%» — кратко для списков. */
export const scaleSummary = (scale: ScaleTier[]) => scale.map((t) => `${t.pct.toString().replace(".", ",")}%`).join(" / ");

export function serializeScale(scale: ScaleTier[]): string {
  return JSON.stringify(scale.map((t) => ({ upTo: t.upTo?.toString() ?? null, pct: t.pct.toString() })));
}

/** Сохранённая шкала; испорченная или пустая запись — шкала по умолчанию. */
export function parseStoredScale(value: string | null | undefined): ScaleTier[] {
  if (!value) return DEFAULT_SCALE;
  try {
    const raw = JSON.parse(value) as Array<{ upTo: string | null; pct: string }>;
    const result = validateScale(raw.map((t) => ({ upTo: t.upTo ?? "", pct: t.pct })));
    return "scale" in result ? result.scale : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}

const number = (text: string) => {
  const clean = text.replace(/\s/g, "").replace(",", ".").replace("%", "");
  return clean && Number.isFinite(Number(clean)) ? new Decimal(clean) : null;
};

/**
 * Шкала из формы: строки «до, ₽» и «%»; полностью пустые пропускаются, у
 * последней ступени граница пустая. Границы растут, проценты от 0 до 100.
 */
export function validateScale(rows: Array<{ upTo: string; pct: string }>): { scale: ScaleTier[] } | { error: string } {
  const filled = rows.filter((r) => r.upTo.trim() || r.pct.trim());
  if (filled.length === 0) return { error: "Заполните хотя бы одну ступень" };
  const scale: ScaleTier[] = [];
  for (let i = 0; i < filled.length; i++) {
    const last = i === filled.length - 1;
    const pct = number(filled[i].pct);
    if (pct === null || pct.lt(0) || pct.gt(100)) return { error: `Ступень ${i + 1}: процент — число от 0 до 100` };
    if (last) {
      if (filled[i].upTo.trim()) return { error: "У последней ступени граница не указывается — она действует для любого большего оборота" };
      scale.push({ upTo: null, pct });
      continue;
    }
    const upTo = number(filled[i].upTo);
    if (upTo === null || upTo.lte(0)) return { error: `Ступень ${i + 1}: укажите границу оборота больше нуля` };
    const prev = scale[i - 1]?.upTo;
    if (prev && upTo.lte(prev)) return { error: `Ступень ${i + 1}: граница должна быть больше предыдущей (${prev.toString()})` };
    scale.push({ upTo, pct });
  }
  return { scale };
}
