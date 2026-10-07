import { describe, expect, it } from "vitest";
import { accrualDateForRun, buildPayrollAccrualDocuments, buildPayrollAccrualLines, splitByMonthDays, unpostedByType, type PayrollLineForPosting } from "./post-to-accrual";
import Decimal from "decimal.js";

function line(overrides: Partial<PayrollLineForPosting> = {}): PayrollLineForPosting {
  return {
    pnlArticleId: "article-labor",
    departmentId: "dept1",
    projectId: null,
    employeeName: "Иванов Иван",
    accrualTypeName: "Оклад",
    amount: 100000,
    insuranceAmount: 30200,
    ...overrides,
  };
}

describe("buildPayrollAccrualLines", () => {
  it("sums amount and insurance into one line per payroll line", () => {
    const drafts = buildPayrollAccrualLines([line()]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].amount.toNumber()).toBe(130200);
    expect(drafts[0].pnlArticleId).toBe("article-labor");
    expect(drafts[0].departmentId).toBe("dept1");
    expect(drafts[0].description).toBe("Иванов Иван — Оклад");
  });

  it("skips lines whose accrual type has no linked pnl article", () => {
    const drafts = buildPayrollAccrualLines([line({ pnlArticleId: null })]);
    expect(drafts).toHaveLength(0);
  });

  it("skips lines with zero or negative total (defensive - should not normally happen)", () => {
    const drafts = buildPayrollAccrualLines([line({ amount: 0, insuranceAmount: 0 })]);
    expect(drafts).toHaveLength(0);
  });

  it("carries projectId through when present, independent of departmentId", () => {
    const drafts = buildPayrollAccrualLines([line({ departmentId: null, projectId: "proj1" })]);
    expect(drafts[0].departmentId).toBeNull();
    expect(drafts[0].projectId).toBe("proj1");
  });

  it("processes multiple lines independently, keeping only the postable ones", () => {
    const drafts = buildPayrollAccrualLines([
      line({ employeeName: "A", pnlArticleId: "art1", amount: 50000, insuranceAmount: 15100 }),
      line({ employeeName: "B", pnlArticleId: null }),
      line({ employeeName: "C", pnlArticleId: "art2", amount: 80000, insuranceAmount: 24160 }),
    ]);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.description)).toEqual(["A — Оклад", "C — Оклад"]);
  });
});

describe("vacation running into the next month", () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

  it("splits an amount by the calendar days of each month, the last part taking the rounding", () => {
    const parts = splitByMonthDays(new Decimal(10000), utc(2026, 9, 25), 14);
    expect(parts.map((p) => [p.month, p.days, p.amount.toNumber()])).toEqual([
      [9, 6, 4285.71],
      [10, 8, 5714.29],
    ]);
    expect(splitByMonthDays(new Decimal(100), utc(2026, 12, 30), 3).map((p) => [p.year, p.month, p.days])).toEqual([
      [2026, 12, 2],
      [2027, 1, 1],
    ]);
  });

  it("keeps the payout month's days in the main document and moves later months to their own documents", () => {
    const docs = buildPayrollAccrualDocuments(
      [
        line({ accrualTypeName: "Оклад", amount: 50000, insuranceAmount: 15000 }),
        line({ accrualTypeName: "Отпускные", amount: 7000, insuranceAmount: 3000, absenceStart: utc(2026, 9, 25), absenceDays: 14 }),
      ],
      utc(2026, 9, 22),
    );
    expect(docs.main.map((d) => d.amount.toNumber())).toEqual([65000, 4285.71]);
    expect(docs.main[1].description).toContain("6 дн. из 14");
    expect(docs.later.map((l) => [l.year, l.month, l.lines.map((x) => x.amount.toNumber())])).toEqual([[2026, 10, [5714.29]]]);
  });

  it("days before the payout month stay in the main document too", () => {
    const docs = buildPayrollAccrualDocuments([line({ amount: 1000, insuranceAmount: 0, absenceStart: utc(2026, 8, 30), absenceDays: 4 })], utc(2026, 9, 10));
    expect(docs.main.map((d) => d.amount.toNumber())).toEqual([1000]);
    expect(docs.later).toEqual([]);
  });
});

describe("the expense date of a payroll run", () => {
  const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
  const day = (d: Date) => d.toISOString().slice(0, 10);

  it("a final settlement is the expense of the month it is for — its last day; an advance and extra runs — the payout date", () => {
    expect(day(accrualDateForRun("FINAL", utc(2026, 10, 10)))).toBe("2026-09-30");
    expect(day(accrualDateForRun("FINAL", utc(2027, 1, 10)))).toBe("2026-12-31");
    expect(day(accrualDateForRun("ADVANCE", utc(2026, 9, 25)))).toBe("2026-09-25");
    expect(day(accrualDateForRun("ADHOC", utc(2026, 9, 22)))).toBe("2026-09-22");
  });

  it("a vacation in a final settlement is split against the month the settlement is for", () => {
    const docs = buildPayrollAccrualDocuments(
      [line({ amount: 14000, insuranceAmount: 0, absenceStart: utc(2026, 9, 25), absenceDays: 14 })],
      accrualDateForRun("FINAL", utc(2026, 10, 10)),
    );
    expect(docs.main.map((d) => d.amount.toNumber())).toEqual([6000]);
    expect(docs.later.map((l) => [l.month, l.lines[0].amount.toNumber()])).toEqual([[10, 8000]]);
  });
});

describe("unpostedByType", () => {
  it("groups lines whose accrual type has no P&L article", () => {
    const result = unpostedByType([
      { accrualTypeName: "Оклад", pnlArticleId: "pnl1", amount: 1000, insuranceAmount: 302 },
      { accrualTypeName: "Компенсация отпуска", pnlArticleId: null, amount: 500, insuranceAmount: 151 },
      { accrualTypeName: "Компенсация отпуска", pnlArticleId: null, amount: 250, insuranceAmount: 0 },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: "Компенсация отпуска", count: 2 });
    expect(result[0].total.toNumber()).toBe(901);
  });
});
