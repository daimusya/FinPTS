import { describe, expect, it } from "vitest";
import { buildPayrollAccrualLines, type PayrollLineForPosting } from "./post-to-accrual";

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
