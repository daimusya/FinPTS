import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { buildCommissionMonth, rateOn, reportLines, reportPayerName, reportTitle, type InflowRow } from "./commissions";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
let seq = 0;
const op = (date: string, amount: number, payerName: string, payerInn: string | null, purpose = "Оплата по счёту"): InflowRow => ({
  id: String(++seq),
  date: d(date),
  amount: new Decimal(amount),
  purpose,
  payerInn,
  payerName,
});

describe("buildCommissionMonth", () => {
  const harlamova = { id: "kh", name: "Харламова", reportName: "Харламова Светлана", commissionPct: new Decimal(20), category: "VIP" as const, turnoverFrom: null, rateChanges: [], clients: [{ id: "c1", name: "ООО ПТФ КонСис" }, { id: "c2", name: "ООО Трейд" }] };
  const noRate = { id: "tt", name: "Татарчук", reportName: null, commissionPct: null, category: "VIP" as const, turnoverFrom: null, rateChanges: [], clients: [{ id: "c3", name: "ООО Прогресс" }] };

  it("считает комиссию от итога поступлений, как шаблон (73 920 × 20% = 14 784)", () => {
    const inflows = [
      op("2026-09-17", 33850, 'ООО "ДЕЖАНЕЙРО"', "7814776596"),
      op("2026-09-22", 13800, 'ООО "ПТФ "КОНСИС"', "7805068406"),
      op("2026-09-22", 18270, 'ООО "ПТФ "КОНСИС"', "7805068406"),
      op("2026-09-24", 8000, 'ООО "ТРЕЙД"', "7801507557"),
      op("2026-09-25", 5000, 'ООО "ПРОГРЕСС"', "7805818426"),
      op("2026-09-26", 9999, 'ООО "НЕИЗВЕСТНО"', "7800000000"),
      op("2026-09-30", 12000, 'ООО "ПРОМТЕХНОСФЕРА"', "7805757131", "Перевод между своими счетами"),
    ];
    // ДЕЖАНЕЙРО нет в списке — закреплён за Харламовой вручную.
    const month = buildCommissionMonth([harlamova, noRate], [{ inn: "7814776596", intermediaryId: "kh" }], inflows, new Set());
    const kh = month.rows.find((r) => r.intermediary.id === "kh")!;
    expect(kh.total.toNumber()).toBe(73920);
    expect(kh.commission?.toNumber()).toBe(14784);
    expect(kh.unconfirmed).toBe(3);
    const tt = month.rows.find((r) => r.intermediary.id === "tt")!;
    expect(tt.total.toNumber()).toBe(5000);
    expect(tt.commission).toBeNull();
    expect(month.totalCommission.toNumber()).toBe(14784);
    expect(month.toReview.map((g) => g.inn)).toEqual(["7805068406", "7801507557", "7805818426"]);
    // Свой перевод не попадает даже в «без посредника».
    expect(month.unassigned.map((g) => g.inn)).toEqual(["7800000000"]);
  });
});

describe("ставка с даты", () => {
  const m = {
    id: "kh",
    name: "Харламова",
    reportName: null,
    category: "VIP" as const,
    turnoverFrom: null,
    commissionPct: new Decimal(20),
    rateChanges: [
      { from: d("2026-09-15"), pct: new Decimal(15) },
      { from: d("2026-11-01"), pct: new Decimal("17.5") },
    ],
    clients: [{ id: "c1", name: "ООО Трейд" }],
  };
  it("действует с указанного дня до следующего изменения", () => {
    expect(rateOn(m, d("2026-09-14"))?.toNumber()).toBe(20);
    expect(rateOn(m, d("2026-09-15"))?.toNumber()).toBe(15);
    expect(rateOn(m, d("2026-10-31"))?.toNumber()).toBe(15);
    expect(rateOn(m, d("2026-11-01"))?.toNumber()).toBe(17.5);
    expect(rateOn({ commissionPct: null, rateChanges: m.rateChanges }, d("2026-01-01"))).toBeNull();
  });
  it("в месяце со сменой ставки комиссия считается по частям", () => {
    const month = buildCommissionMonth(
      [m],
      [],
      [op("2026-09-03", 10000, 'ООО "ТРЕЙД"', "7801507557"), op("2026-09-14", 5000, 'ООО "ТРЕЙД"', "7801507557"), op("2026-09-20", 20000, 'ООО "ТРЕЙД"', "7801507557")],
      new Set(),
    );
    const row = month.rows[0];
    expect(row.parts.map((p) => [p.pct?.toNumber(), p.from.toISOString().slice(0, 10), p.to.toISOString().slice(0, 10), p.total.toNumber(), p.commission?.toNumber()])).toEqual([
      [20, "2026-09-03", "2026-09-14", 15000, 3000],
      [15, "2026-09-20", "2026-09-20", 20000, 3000],
    ]);
    expect(row.commission?.toNumber()).toBe(6000);
    expect(month.totalCommission.toNumber()).toBe(6000);
  });
});

describe("печатная форма", () => {
  it("называет покупателя как 1С и складывает оплаты одного дня", () => {
    expect(reportPayerName('ООО "ПТФ "КОНСИС"')).toBe("ПТФ КОНСИС ООО");
    expect(reportPayerName('ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "Конкрит Строй"')).toBe("КОНКРИТ СТРОЙ ООО");
    expect(reportPayerName("ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ Козлов Олег Геннадьевич")).toBe("Козлов Олег Геннадьевич ИП");
    expect(reportPayerName("Божко Андрей Юрьевич (ИП)")).toBe("Божко Андрей Юрьевич ИП");
    const lines = reportLines([
      op("2026-09-22", 13800, 'ООО "ПТФ "КОНСИС"', "7805068406"),
      op("2026-09-17", 33850, 'ООО "ДЕЖАНЕЙРО"', "7814776596"),
      op("2026-09-22", 18270, 'ООО "ПТФ "КОНСИС"', "7805068406"),
    ]);
    expect(lines.map((l) => [l.date.toISOString().slice(0, 10), l.text, l.amount.toNumber()])).toEqual([
      ["2026-09-17", "Покупатель: ДЕЖАНЕЙРО ООО", 33850],
      ["2026-09-22", "Покупатель: ПТФ КОНСИС ООО", 32070],
    ]);
    expect(reportTitle(2026, 9)).toBe("Анализ поступлений и платежей за Сентябрь 2026 г.");
  });
});
