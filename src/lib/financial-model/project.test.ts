import { describe, expect, it } from "vitest";
import { projectScenario, type ScenarioValueRow } from "./project";

function row(year: number, month: number, driver: string, value: number, dimension: string | null = null): ScenarioValueRow {
  return { year, month, driver, dimension, value };
}

describe("projectScenario", () => {
  it("computes revenue as avg_check * sales_count with 100% default seasonality/activation", () => {
    const rows = [row(2026, 1, "avg_check", 1000), row(2026, 1, "sales_count", 50)];
    const [m] = projectScenario(2026, 1, 1, rows, 0);
    expect(m.revenue.toNumber()).toBe(50000);
  });

  it("applies seasonality and activation multipliers when set below 100%", () => {
    const rows = [
      row(2026, 1, "avg_check", 1000),
      row(2026, 1, "sales_count", 100),
      row(2026, 1, "seasonality_pct", 50),
      row(2026, 1, "new_service_activation_pct", 80),
    ];
    const [m] = projectScenario(2026, 1, 1, rows, 0);
    // 1000 * 100 * 0.5 * 0.8 = 40000
    expect(m.revenue.toNumber()).toBe(40000);
  });

  it("computes gross and operating profit through the full cost waterfall", () => {
    const rows = [
      row(2026, 1, "avg_check", 1000),
      row(2026, 1, "sales_count", 100), // revenue 100000
      row(2026, 1, "variable_cost_pct", 30), // 30000
      row(2026, 1, "fixed_costs", 20000),
      row(2026, 1, "headcount", 2),
      row(2026, 1, "avg_employee_cost", 15000), // payroll 30000
    ];
    const [m] = projectScenario(2026, 1, 1, rows, 0);
    expect(m.grossProfit.toNumber()).toBe(70000); // 100000 - 30000
    expect(m.operatingProfit.toNumber()).toBe(20000); // 70000 - 20000 - 30000
  });

  it("forecasts required department headcount from sales_count / productivity, rounding up", () => {
    const rows = [row(2026, 1, "sales_count", 55, "dept-training"), row(2026, 1, "productivity_per_employee", 20, "dept-training")];
    const [m] = projectScenario(2026, 1, 1, rows, 0);
    expect(m.departmentHeadcount).toEqual([{ departmentId: "dept-training", requiredHeadcount: 3 }]); // ceil(55/20)=3
    expect(m.totalHeadcount).toBe(3);
  });

  it("sums department-forecast headcount with the manual fallback headcount", () => {
    const rows = [
      row(2026, 1, "sales_count", 40, "dept-a"),
      row(2026, 1, "productivity_per_employee", 20, "dept-a"),
      row(2026, 1, "headcount", 5),
    ];
    const [m] = projectScenario(2026, 1, 1, rows, 0);
    expect(m.totalHeadcount).toBe(7); // ceil(40/20)=2 + 5 manual
  });

  it("rolls cash balance forward month over month, subtracting loan payments", () => {
    const rows = [
      row(2026, 1, "avg_check", 1000),
      row(2026, 1, "sales_count", 100),
      row(2026, 1, "loan_payment", 5000),
      row(2026, 2, "avg_check", 1000),
      row(2026, 2, "sales_count", 100),
    ];
    const projection = projectScenario(2026, 1, 2, rows, 10000);
    // month 1: cash = 10000 + 100000 (no costs) - 5000 loan = 105000
    expect(projection[0].cashBalance.toNumber()).toBe(105000);
    // month 2: cash = 105000 + 100000 = 205000
    expect(projection[1].cashBalance.toNumber()).toBe(205000);
  });

  it("spans a year boundary correctly (December -> January)", () => {
    const rows = [row(2027, 1, "avg_check", 500), row(2027, 1, "sales_count", 10)];
    const projection = projectScenario(2026, 12, 2, rows, 0);
    expect(projection[0]).toMatchObject({ year: 2026, month: 12 });
    expect(projection[1]).toMatchObject({ year: 2027, month: 1 });
    expect(projection[1].revenue.toNumber()).toBe(5000);
  });

  it("includes intermediary commission as a direct cost reducing gross profit", () => {
    const rows = [
      row(2026, 1, "avg_check", 1000),
      row(2026, 1, "sales_count", 100), // revenue 100000
      row(2026, 1, "intermediary_share_pct", 50), // 50000 via intermediaries
      row(2026, 1, "intermediary_commission_pct", 10), // 10% commission -> 5000
    ];
    const [m] = projectScenario(2026, 1, 1, rows, 0);
    expect(m.intermediaryCommission.toNumber()).toBe(5000);
    expect(m.grossProfit.toNumber()).toBe(95000);
  });
});
