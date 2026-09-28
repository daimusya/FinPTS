import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import { computeSickLeaveBenefit, computeVacationPay, earningsMonth, insuranceTenure, monthKey, salaryAt } from "./average-earnings";

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

describe("salary history and insurance tenure", () => {
  const changes = [
    { date: utc(2026, 4, 1), from: d(100000), to: d(120000) },
    { date: utc(2026, 9, 8), from: d(120000), to: d(130000) },
  ];

  it("finds the salary in force on a date", () => {
    expect(salaryAt(changes, utc(2026, 3, 31), d(130000))!.toNumber()).toBe(100000);
    expect(salaryAt(changes, utc(2026, 4, 1), null)!.toNumber()).toBe(120000);
    expect(salaryAt(changes, utc(2026, 9, 30), null)!.toNumber()).toBe(130000);
    expect(salaryAt([], utc(2026, 1, 1), d(50000))!.toNumber()).toBe(50000);
  });

  it("adds prior tenure to full months worked here and picks the percent", () => {
    expect(insuranceTenure(0, utc(2026, 5, 15), utc(2026, 9, 14))).toEqual({ months: 3, pct: 60, short: true });
    expect(insuranceTenure(0, utc(2026, 3, 15), utc(2026, 9, 15))).toEqual({ months: 6, pct: 60, short: false });
    expect(insuranceTenure(58, utc(2026, 1, 1), utc(2026, 3, 1))).toMatchObject({ months: 60, pct: 80 });
    expect(insuranceTenure(90, utc(2026, 1, 1), utc(2026, 7, 1))).toMatchObject({ months: 96, pct: 100 });
  });
});

describe("computeVacationPay — indexation (п. 16 Положения № 922)", () => {
  const yearOf = (amountFor: (y: number, m: number) => number) =>
    monthly(
      Array.from({ length: 12 }, (_, i) => {
        const total = 2026 * 12 + 8 - 12 + i; // Sep 2025 … Aug 2026
        const y = Math.floor(total / 12);
        const m = (total % 12) + 1;
        return [y, m, amountFor(y, m)] as [number, number, number];
      }),
    );
  const base = { vacationStart: utc(2026, 9, 1), vacationDays: 14, hireDate: utc(2020, 1, 1), excludedDates: new Set<string>() };

  it("raises the salary part of months before a raise inside the period; bonuses stay as they are", () => {
    const before = (y: number, m: number) => y === 2025 || m < 4;
    const earnings = yearOf((y, m) => (before(y, m) ? 100000 : 120000) + (y === 2025 && m === 12 ? 30000 : 0));
    const indexable = yearOf((y, m) => (before(y, m) ? 100000 : 120000));
    const changes = [{ date: utc(2026, 4, 1), from: d(100000), to: d(120000) }];
    const plain = computeVacationPay({ ...base, earningsByMonth: earnings, salary: d(120000) });
    const indexed = computeVacationPay({ ...base, earningsByMonth: earnings, salary: d(120000), indexation: { changes, indexableByMonth: indexable } });
    expect(plain.totalEarnings.toNumber()).toBe(1330000);
    const dec = indexed.months.find((m) => m.year === 2025 && m.month === 12)!;
    expect(dec.indexCoef!.toNumber()).toBe(1.2);
    expect(dec.indexedEarnings.toNumber()).toBe(150000); // 130 000 + 100 000 × 0,2 — the 30 000 bonus is not indexed
    expect(indexed.months.find((m) => m.month === 4)!.indexCoef).toBeNull();
    expect(indexed.totalEarnings.toNumber()).toBe(1470000);
    expect(indexed.avgDaily.toNumber()).toBe(4180.89);
    expect(indexed.amount.toNumber()).toBe(58532.46);
  });

  it("indexes the whole average for a raise after the period, and only the vacation days after a raise inside the vacation", () => {
    const earnings = yearOf(() => 100000);
    const after = computeVacationPay({
      ...base,
      earningsByMonth: earnings,
      salary: d(110000),
      indexation: { changes: [{ date: utc(2026, 9, 1), from: d(100000), to: d(110000) }], indexableByMonth: earnings },
    });
    expect(after.afterPeriod).toMatchObject({ avgDailyBefore: d(3412.97) });
    expect(after.avgDaily.toNumber()).toBe(3754.27);
    expect(after.amount.toNumber()).toBe(52559.78);

    const during = computeVacationPay({
      ...base,
      earningsByMonth: earnings,
      salary: d(110000),
      indexation: { changes: [{ date: utc(2026, 9, 8), from: d(100000), to: d(110000) }], indexableByMonth: earnings },
    });
    expect(during.afterPeriod).toBeNull();
    expect(during.duringVacation).toEqual([{ date: utc(2026, 9, 8), days: 7, coef: d(1.1) }]);
    expect(during.amount.toNumber()).toBe(50170.68); // 7 × 3 412,97 + 7 × 3 754,27
  });
});

describe("computeSickLeaveBenefit — district coefficient, short tenure, replaced years", () => {
  const limits = new Map([
    [2021, d(1465000)],
    [2022, d(1565000)],
    [2024, d(2225000)],
    [2025, d(2759000)],
  ]);

  it("raises the МРОТ minimum by the district coefficient", () => {
    const r = computeSickLeaveBenefit({
      illnessStart: utc(2026, 3, 2),
      sickDays: 1,
      tenurePct: 100,
      earningsByYear: new Map(),
      baseLimitByYear: limits,
      mrot: d(27093),
      districtCoef: d(1.15),
    });
    expect(r.minDaily.toNumber()).toBe(1024.34);
    expect(r.total.toNumber()).toBe(1024.34);
  });

  it("caps each day at МРОТ / days of its month when the tenure is under 6 months", () => {
    const r = computeSickLeaveBenefit({
      illnessStart: utc(2026, 3, 30),
      sickDays: 4,
      tenurePct: 60,
      shortTenure: true,
      earningsByYear: new Map([
        [2024, d(2225000)],
        [2025, d(2759000)],
      ]),
      baseLimitByYear: limits,
      mrot: d(27093),
    });
    expect(r.dailyBenefit.toNumber()).toBe(4096.44);
    expect(r.monthlyCaps.map((c) => [c.month, c.days, c.capDaily.toNumber(), c.applied])).toEqual([
      [3, 2, 873.97, true],
      [4, 2, 903.1, true],
    ]);
    expect(r.total.toNumber()).toBe(3554.14);
    expect(r.employerAmount.toNumber()).toBe(2651.04);
    expect(r.fundAmount.toNumber()).toBe(903.1);
  });

  it("uses the replacement years when given", () => {
    const r = computeSickLeaveBenefit({
      illnessStart: utc(2026, 3, 2),
      sickDays: 1,
      tenurePct: 100,
      calcYears: [2021, 2022],
      earningsByYear: new Map([
        [2021, d(1000000)],
        [2022, d(2000000)],
      ]),
      baseLimitByYear: limits,
      mrot: d(27093),
    });
    expect(r.years.map((y) => [y.year, y.counted.toNumber()])).toEqual([
      [2021, 1000000],
      [2022, 1565000],
    ]);
    expect(r.avgDaily.toNumber()).toBe(3513.7);
  });
});
