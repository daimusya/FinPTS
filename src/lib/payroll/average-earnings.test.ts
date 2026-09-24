import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import { computeSickLeaveBenefit, computeVacationPay, earningsMonth, monthKey } from "./average-earnings";

const d = (v: number | string) => toDecimal(v);
const utc = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

function monthly(entries: Array<[number, number, number]>) {
  return new Map(entries.map(([y, m, amount]) => [monthKey(y, m), d(amount)]));
}

describe("earningsMonth", () => {
  it("attributes the final settlement on the 10th to the previous month, the advance to its own", () => {
    expect(earningsMonth("FINAL", utc(2026, 1, 10))).toEqual({ year: 2025, month: 12 });
    expect(earningsMonth("ADVANCE", utc(2026, 1, 25))).toEqual({ year: 2026, month: 1 });
    expect(earningsMonth("ADHOC", utc(2026, 3, 5))).toEqual({ year: 2026, month: 3 });
  });
});

describe("computeVacationPay", () => {
  it("divides a fully worked year by 12 × 29.3", () => {
    const earnings = monthly(
      Array.from({ length: 12 }, (_, i) => {
        const total = 2026 * 12 + 8 - 12 + i; // Sep 2025 … Aug 2026
        return [Math.floor(total / 12), (total % 12) + 1, 100000] as [number, number, number];
      }),
    );
    const result = computeVacationPay({
      vacationStart: utc(2026, 9, 1),
      vacationDays: 14,
      hireDate: utc(2020, 1, 1),
      earningsByMonth: earnings,
      excludedDates: new Set(),
      salary: d(100000),
    });
    expect(result.months[0]).toMatchObject({ year: 2025, month: 9 });
    expect(result.months[11]).toMatchObject({ year: 2026, month: 8 });
    expect(result.totalDays.toNumber()).toBeCloseTo(351.6, 10);
    expect(result.avgDaily.toNumber()).toBe(3412.97);
    expect(result.amount.toNumber()).toBe(47781.58);
    expect(result.method).toBe("average");
  });

  it("counts partial months proportionally: hired mid-month and a sick leave excluded", () => {
    const excluded = new Set(["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"]);
    const result = computeVacationPay({
      vacationStart: utc(2026, 9, 1),
      vacationDays: 14,
      hireDate: utc(2026, 3, 16),
      earningsByMonth: monthly([
        [2026, 3, 50000],
        [2026, 4, 100000],
        [2026, 5, 80000],
        [2026, 6, 100000],
        [2026, 7, 100000],
        [2026, 8, 100000],
      ]),
      excludedDates: excluded,
      salary: d(100000),
    });
    const march = result.months.find((m) => m.month === 3 && m.year === 2026)!;
    expect(march.employedDays).toBe(16);
    expect(march.countedDays.toNumber()).toBeCloseTo((29.3 * 16) / 31, 10);
    const may = result.months.find((m) => m.month === 5 && m.year === 2026)!;
    expect(may.excludedDays).toBe(5);
    expect(may.countedDays.toNumber()).toBeCloseTo((29.3 * 26) / 31, 10);
    expect(result.months.find((m) => m.year === 2025 && m.month === 12)!.countedDays.toNumber()).toBe(0);
    // (29.3×16 + 29.3×26)/31 + 29.3×4 = 4863.8 / 31
    expect(result.totalDays.toNumber()).toBeCloseTo(4863.8 / 31, 10);
    expect(result.totalEarnings.toNumber()).toBe(530000);
    expect(result.avgDaily.toNumber()).toBe(3378.02);
    expect(result.amount.toNumber()).toBe(47292.28);
  });

  it("falls back to the salary when the billing period is empty", () => {
    const result = computeVacationPay({
      vacationStart: utc(2026, 9, 10),
      vacationDays: 3,
      hireDate: utc(2026, 9, 1),
      earningsByMonth: new Map(),
      excludedDates: new Set(),
      salary: d(100000),
    });
    expect(result.method).toBe("salary");
    expect(result.avgDaily.toNumber()).toBe(3412.97);
    expect(result.amount.toNumber()).toBe(10238.91);
  });

  it("refuses without earnings and without a salary, and rejects a non-integer number of days", () => {
    const base = { vacationStart: utc(2026, 9, 10), hireDate: utc(2026, 9, 1), earningsByMonth: new Map(), excludedDates: new Set<string>(), salary: null };
    expect(() => computeVacationPay({ ...base, vacationDays: 5 })).toThrow("оклад");
    expect(() => computeVacationPay({ ...base, vacationDays: 1.5, salary: d(1) })).toThrow("целым");
  });
});

describe("computeSickLeaveBenefit", () => {
  const limits = new Map([
    [2024, d(2225000)],
    [2025, d(2759000)],
  ]);

  it("caps each year at the base limit, divides by 730 and applies the tenure percent", () => {
    const result = computeSickLeaveBenefit({
      illnessStart: utc(2026, 3, 2),
      sickDays: 7,
      tenurePct: 80,
      earningsByYear: new Map([
        [2024, d(1200000)],
        [2025, d(3000000)],
      ]),
      baseLimitByYear: limits,
      mrot: d(27093),
    });
    expect(result.years.map((y) => [y.year, y.counted.toNumber()])).toEqual([
      [2024, 1200000],
      [2025, 2759000],
    ]);
    expect(result.avgDaily.toNumber()).toBe(5423.29);
    expect(result.basis).toBe("actual");
    expect(result.dailyBenefit.toNumber()).toBe(4338.63);
    expect(result.total.toNumber()).toBe(30370.41);
    expect(result.employerDays).toBe(3);
    expect(result.employerAmount.toNumber()).toBe(13015.89);
    expect(result.fundAmount.toNumber()).toBe(17354.52);
  });

  it("uses the МРОТ minimum when actual earnings are lower, counting other employers' earnings", () => {
    const result = computeSickLeaveBenefit({
      illnessStart: utc(2026, 3, 2),
      sickDays: 2,
      tenurePct: 60,
      earningsByYear: new Map(),
      otherEmployersByYear: new Map([[2025, d(100000)]]),
      baseLimitByYear: limits,
      mrot: d(27093),
    });
    expect(result.avgDailyActual.toNumber()).toBe(136.99);
    expect(result.minDaily.toNumber()).toBe(890.73);
    expect(result.basis).toBe("mrot");
    expect(result.dailyBenefit.toNumber()).toBe(534.44);
    expect(result.total.toNumber()).toBe(1068.88);
    expect(result.employerAmount.toNumber()).toBe(1068.88);
    expect(result.fundAmount.toNumber()).toBe(0);
  });

  it("names the missing year when the base limit is not configured", () => {
    expect(() =>
      computeSickLeaveBenefit({
        illnessStart: utc(2026, 3, 2),
        sickDays: 5,
        tenurePct: 100,
        earningsByYear: new Map(),
        baseLimitByYear: new Map([[2025, d(2759000)]]),
        mrot: d(27093),
      }),
    ).toThrow("2024");
  });
});
