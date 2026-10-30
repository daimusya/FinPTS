import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { DEFAULT_SCALE, parseStoredScale, scalePct, serializeScale, tierLabel, validateScale } from "./standard-scale";
import { buildCommissionMonth, type InflowRow } from "./commissions";

/** Суммы форматируются с неразрывными пробелами. */
const plain = (s: string) => s.replace(/ /g, " ");
const d = (s: string) => new Date(`${s}T00:00:00Z`);
let seq = 0;
const pay = (date: string, amount: number): InflowRow => ({
  id: String(++seq).padStart(4, "0"),
  date: d(date),
  amount: new Decimal(amount),
  purpose: "Оплата по счёту",
  payerInn: "7801507557",
  payerName: 'ООО "ТРЕЙД"',
});
const standard = (turnoverFrom: Date | null = null) => ({
  id: "st",
  name: "Петров",
  reportName: null,
  category: "STANDARD" as const,
  turnoverFrom,
  commissionPct: null,
  rateChanges: [],
  clients: [{ id: "c1", name: "ООО Трейд" }],
});

describe("шкала «Стандарт»", () => {
  it("ступень включает свою границу", () => {
    expect(scalePct(DEFAULT_SCALE, new Decimal(50000)).toNumber()).toBe(5);
    expect(scalePct(DEFAULT_SCALE, new Decimal("50000.01")).toNumber()).toBe(10);
    expect(scalePct(DEFAULT_SCALE, new Decimal(150000)).toNumber()).toBe(10);
    expect(scalePct(DEFAULT_SCALE, new Decimal(150001)).toNumber()).toBe(15);
    expect([0, 1, 2].map((i) => plain(tierLabel(DEFAULT_SCALE, i)))).toEqual(["до 50 000", "от 50 000 до 150 000", "более 150 000"]);
  });

  it("правится: границы растут, у последней ступени границы нет", () => {
    const ok = validateScale([
      { upTo: "100 000", pct: "7" },
      { upTo: "", pct: "12,5" },
      { upTo: "", pct: "" },
    ]);
    expect("scale" in ok && ok.scale.map((t) => [t.upTo?.toNumber() ?? null, t.pct.toNumber()])).toEqual([
      [100000, 7],
      [null, 12.5],
    ]);
    expect(validateScale([{ upTo: "100000", pct: "5" }, { upTo: "50000", pct: "10" }, { upTo: "", pct: "15" }])).toHaveProperty("error");
    expect(validateScale([{ upTo: "50000", pct: "5" }, { upTo: "150000", pct: "10" }])).toHaveProperty("error");
    expect(validateScale([{ upTo: "", pct: "120" }])).toHaveProperty("error");
    expect("scale" in ok && parseStoredScale(serializeScale(ok.scale)).map((t) => t.pct.toNumber())).toEqual([7, 12.5]);
    expect(parseStoredScale("испорчено")).toBe(DEFAULT_SCALE);
  });

  it("оплата целиком идёт по ступени, куда попал накопленный итог вместе с ней", () => {
    // Накоплено 40 000, приходит 30 000 — итог 70 000, ступень 10%: 3 000.
    const month = buildCommissionMonth([standard()], [], [pay("2026-09-05", 30000), pay("2026-09-20", 100000)], new Set(), {
      priorTurnover: new Map([["st", new Decimal(40000)]]),
    });
    const row = month.rows[0];
    expect(row.parts.map((p) => [p.pct?.toNumber(), p.total.toNumber(), p.commission?.toNumber()])).toEqual([
      [10, 30000, 3000],
      [15, 100000, 15000],
    ]);
    expect(row.commission?.toNumber()).toBe(18000);
    expect(month.turnoverAfter.get("st")?.toNumber()).toBe(170000);
    expect(plain(row.parts[1].basis!)).toBe("ступень более 150 000, накоплено к 20.09.2026 — 170 000");
  });

  it("оплаты до даты начала оборота в него не входят и комиссии по шкале не дают", () => {
    const month = buildCommissionMonth([standard(d("2026-09-10"))], [], [pay("2026-09-01", 60000), pay("2026-09-15", 60000)], new Set());
    const row = month.rows[0];
    expect(row.parts.map((p) => [p.pct?.toNumber() ?? null, p.commission?.toNumber() ?? null])).toEqual([
      [null, null],
      [10, 6000],
    ]);
    expect(month.turnoverAfter.get("st")?.toNumber()).toBe(60000);
  });
});
