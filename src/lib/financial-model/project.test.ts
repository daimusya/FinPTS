import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { projectScenario, rampShare, type NewServiceInput, type ScenarioValueRow } from "./project";
import type { LoanInput } from "./cash-timing";

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

describe("new services", () => {
  const service = (over: Partial<NewServiceInput> = {}): NewServiceInput => ({
    id: "s1",
    name: "Обучение по охране труда онлайн",
    launchYear: 2026,
    launchMonth: 3,
    avgCheck: 5000,
    salesPerMonth: 10,
    rampUpMonths: 0,
    variableCostPct: null,
    ...over,
  });

  it("adds nothing before the launch month and full revenue from it", () => {
    const rows = [row(2026, 1, "avg_check", 1000), row(2026, 1, "sales_count", 100)];
    const projection = projectScenario(2026, 1, 4, rows, 0, [service()]);
    expect(projection.map((m) => m.newServicesRevenue.toNumber())).toEqual([0, 0, 50000, 50000]);
    expect(projection[0].revenue.toNumber()).toBe(100000);
    expect(projection[2].baseRevenue.toNumber()).toBe(0); // base drivers were only set for January
    expect(projection[2].newServices).toEqual([expect.objectContaining({ id: "s1", name: "Обучение по охране труда онлайн" })]);
  });

  it("ramps up linearly over the given number of months", () => {
    expect([0, 1, 2, 3, 4].map((k) => rampShare(k, 4).toNumber())).toEqual([0.25, 0.5, 0.75, 1, 1]);
    expect(rampShare(-1, 4).toNumber()).toBe(0);
    expect(rampShare(0, 0).toNumber()).toBe(1);
    const projection = projectScenario(2026, 3, 3, [], 0, [service({ rampUpMonths: 4 })]);
    expect(projection.map((m) => m.newServicesRevenue.toNumber())).toEqual([12500, 25000, 37500]);
  });

  it("applies scenario seasonality but not the base-revenue adjustment", () => {
    const rows = [
      row(2026, 3, "avg_check", 1000),
      row(2026, 3, "sales_count", 100),
      row(2026, 3, "seasonality_pct", 50),
      row(2026, 3, "new_service_activation_pct", 50),
    ];
    const [m] = projectScenario(2026, 3, 1, rows, 0, [service()]);
    expect(m.baseRevenue.toNumber()).toBe(25000); // 100000 × 0.5 × 0.5
    expect(m.newServicesRevenue.toNumber()).toBe(25000); // 50000 × 0.5 seasonality only
    expect(m.revenue.toNumber()).toBe(50000);
  });

  it("uses the service's own variable cost percent, or the scenario's when not set", () => {
    const rows = [row(2026, 3, "avg_check", 1000), row(2026, 3, "sales_count", 100), row(2026, 3, "variable_cost_pct", 30)];
    const [own] = projectScenario(2026, 3, 1, rows, 0, [service({ variableCostPct: 10 })]);
    expect(own.variableCosts.toNumber()).toBe(35000); // 30000 base + 5000 service
    const [inherited] = projectScenario(2026, 3, 1, rows, 0, [service()]);
    expect(inherited.variableCosts.toNumber()).toBe(45000); // 30000 + 15000
    expect(inherited.grossProfit.toNumber()).toBe(105000); // 150000 − 45000
  });

  it("adds the service's staff as it ramps up, its fixed costs from launch and launch costs once", () => {
    const rows = [3, 4, 5].flatMap((m) => [row(2026, m, "avg_employee_cost", 50000), row(2026, m, "headcount", 2)]);
    const staffed = service({ rampUpMonths: 3, staffHeadcount: 4, staffCostPerEmployee: 60000, monthlyFixedCosts: 20000, launchCosts: 100000 });
    const projection = projectScenario(2026, 3, 3, rows, 0, [staffed]);
    expect(projection.map((m) => m.newServices[0].headcount)).toEqual([2, 3, 4]); // ceil(4 × 1/3, 2/3, 1)
    expect(projection.map((m) => m.totalHeadcount)).toEqual([4, 5, 6]);
    expect(projection.map((m) => m.payrollCost.toNumber())).toEqual([220000, 280000, 340000]); // 2 × 50 000 + service staff × 60 000
    expect(projection.map((m) => m.fixedCosts.toNumber())).toEqual([120000, 20000, 20000]);
    expect(projection[2].newServices[0]).toMatchObject({ revenue: expect.anything(), payrollCost: expect.anything() });
    expect(projection[2].newServices[0].contribution.toNumber()).toBe(-210000); // 50 000 − 240 000 − 20 000
    expect(projection[2].operatingProfit.toNumber()).toBe(50000 - 340000 - 20000);
  });

  it("prices the service's staff at the scenario's average cost when its own is not set", () => {
    const rows = [row(2026, 3, "avg_employee_cost", 50000)];
    const [m] = projectScenario(2026, 3, 1, rows, 0, [service({ staffHeadcount: 3 })]);
    expect(m.newServices[0].payrollCost.toNumber()).toBe(150000);
    expect(m.payrollCost.toNumber()).toBe(150000);
  });

  it("charges the intermediary commission on new-service revenue as well", () => {
    const rows = [row(2026, 3, "intermediary_share_pct", 50), row(2026, 3, "intermediary_commission_pct", 10)];
    const [m] = projectScenario(2026, 3, 1, rows, 0, [service()]);
    expect(m.intermediaryCommission.toNumber()).toBe(2500); // 50000 × 50% × 10%
  });
});

describe("cash timing in the forecast", () => {
  const revenueRows = (months: number[]) =>
    months.flatMap((m) => [row(2026, m, "avg_check", 1000), row(2026, m, "sales_count", 100)]); // 100 000 a month

  it("collects revenue after the customer payment delay and keeps the rest as receivables", () => {
    const rows = [...revenueRows([1, 2, 3]), ...[1, 2, 3].map((m) => row(2026, m, "customer_payment_days", 30))];
    const p = projectScenario(2026, 1, 3, rows, 10000);
    expect(p.map((m) => m.collections.toNumber())).toEqual([0, 100000, 100000]);
    expect(p.map((m) => m.cashBalance.toNumber())).toEqual([10000, 110000, 210000]);
    expect(p[2].receivableEnd.toNumber()).toBe(100000);
    expect(p[2].operatingProfit.toNumber()).toBe(100000); // profit is unaffected by when the money arrives
  });

  it("pays variable costs after the supplier delay, fixed costs in the same month", () => {
    const rows = [
      ...revenueRows([1, 2]),
      row(2026, 1, "variable_cost_pct", 40),
      row(2026, 2, "variable_cost_pct", 40),
      row(2026, 1, "supplier_payment_days", 30),
      row(2026, 2, "supplier_payment_days", 30),
      row(2026, 1, "fixed_costs", 5000),
      row(2026, 2, "fixed_costs", 5000),
    ];
    const p = projectScenario(2026, 1, 2, rows, 0);
    expect(p.map((m) => m.supplierPayments.toNumber())).toEqual([0, 40000]);
    expect(p.map((m) => m.cashBalance.toNumber())).toEqual([95000, 150000]); // 100 000 − 5 000; + 100 000 − 40 000 − 5 000
    expect(p[1].payableEnd.toNumber()).toBe(40000);
  });

  it("collects today's receivables and pays today's payables in the first month", () => {
    const p = projectScenario(2026, 1, 2, [], 1000, [], { openingReceivable: 50000, openingPayable: 20000 });
    expect(p.map((m) => m.cashBalance.toNumber())).toEqual([31000, 31000]);
    expect([p[0].openingReceivableCollected.toNumber(), p[0].openingPayablePaid.toNumber()]).toEqual([50000, 20000]);
    expect([p[0].receivableEnd.toNumber(), p[0].payableEnd.toNumber()]).toEqual([0, 0]);
  });

  const loan = (over: Partial<LoanInput> = {}): LoanInput => ({
    id: "l1",
    name: "Кредит на оборудование",
    amount: new Decimal(1200000),
    startIndex: 2026 * 12 + 0, // January 2026
    annualRatePct: new Decimal(12),
    termMonths: 12,
    repayment: "linear",
    ...over,
  });

  it("brings the loan in, charges interest to profit and repays principal from cash only", () => {
    const rows = revenueRows([1, 2]);
    const p = projectScenario(2026, 1, 2, rows, 0, [], { loans: [loan()] });
    expect([p[0].loanDrawdown.toNumber(), p[0].loanDebt.toNumber()]).toEqual([1200000, 1200000]);
    expect([p[1].loanInterest.toNumber(), p[1].loanPrincipal.toNumber(), p[1].loanDebt.toNumber()]).toEqual([12000, 100000, 1100000]);
    expect(p[1].operatingProfit.toNumber()).toBe(100000);
    expect(p[1].netProfit.toNumber()).toBe(88000);
    expect(p.map((m) => m.cashBalance.toNumber())).toEqual([1300000, 1288000]); // 1 200 000 + 100 000; + 100 000 − 12 000 − 100 000
  });

  it("starts with the remaining debt of a loan taken before the forecast", () => {
    // Loan from January: the February payment falls before the forecast starts (March), the March one inside it.
    const p = projectScenario(2026, 3, 1, [], 0, [], { loans: [loan()] });
    expect(p[0].loanInterest.toNumber()).toBe(11000); // 1% of 1 100 000
    expect(p[0].loanDebt.toNumber()).toBe(1000000);
  });
});

describe("projectScenario — terms, own service lags and taxes", () => {
  const start = 2027 * 12;
  const service = (over: Partial<NewServiceInput> = {}): NewServiceInput => ({
    id: "s",
    name: "Услуга",
    launchYear: 2027,
    launchMonth: 1,
    avgCheck: 1000,
    salesPerMonth: 100,
    rampUpMonths: 0,
    variableCostPct: 0,
    ...over,
  });

  it("repays the current receivable by the documents' due dates", () => {
    const p = projectScenario(2027, 1, 12, [], 0, [], {
      openingReceivable: new Decimal(220),
      openingReceivableDue: [
        { index: start - 2, amount: new Decimal(100) }, // overdue: first month
        { index: start + 1, amount: new Decimal(50) },
        { index: start + 20, amount: new Decimal(70) }, // after the horizon: still owed
      ],
    });
    expect(p.slice(0, 3).map((m) => m.openingReceivableCollected.toNumber())).toEqual([100, 50, 0]);
    expect(p[11].receivableEnd.toNumber()).toBe(70);
    expect(p[11].cashBalance.toNumber()).toBe(150);
  });

  it("collects a new service's revenue with its own payment terms", () => {
    const p = projectScenario(2027, 1, 4, [], 0, [service({ customerPaymentDays: 60 })]);
    expect(p.map((m) => m.collections.toNumber())).toEqual([0, 0, 100000, 100000]);
    expect(p[3].receivableEnd.toNumber()).toBe(200000);
  });

  it("charges the tax in the profit and pays it after the quarter", () => {
    const p = projectScenario(2027, 1, 4, [], 0, [service()], { tax: { regime: "usn_income", ratePct: new Decimal(6) } });
    expect(p[0].tax.toNumber()).toBe(6000);
    expect(p[0].netProfit.toNumber()).toBe(94000);
    expect(p.map((m) => m.taxPaid.toNumber())).toEqual([0, 0, 0, 18000]);
    expect(p[3].cashBalance.toNumber()).toBe(400000 - 18000);
    expect(p[3].taxPayableEnd.toNumber()).toBe(6000);
  });
});

describe("projectScenario — sole proprietor's contributions", () => {
  it("lower the net profit as accrued and the cash when paid in December", () => {
    const service: NewServiceInput = { id: "s", name: "Услуга", launchYear: 2026, launchMonth: 1, avgCheck: 1000, salesPerMonth: 100, rampUpMonths: 0, variableCostPct: 0 };
    const p = projectScenario(2026, 1, 12, [], 0, [service], {
      ipContribution: { base: "income", forYear: () => ({ fixed: new Decimal(12000), income: null }) },
    });
    expect(p[0].ipContribution.toNumber()).toBe(1000);
    expect(p[0].netProfit.toNumber()).toBe(99000);
    expect(p[10].cashBalance.toNumber()).toBe(1100000);
    expect(p[11].ipContributionPaid.toNumber()).toBe(12000);
    expect(p[11].cashBalance.toNumber()).toBe(1200000 - 12000);
  });
});

describe("projectScenario — USN reduced by contributions", () => {
  const service: NewServiceInput = { id: "s", name: "Услуга", launchYear: 2027, launchMonth: 1, avgCheck: 1000, salesPerMonth: 100, rampUpMonths: 0, variableCostPct: 0 };
  const extras = (registeredEmployees: boolean) => ({
    tax: { regime: "usn_income" as const, ratePct: new Decimal(6) },
    ipContribution: { base: "income" as const, forYear: () => ({ fixed: new Decimal(12000), income: null }) },
    taxReduction: { employeeInsuranceShare: new Decimal(30.2).dividedBy(130.2), registeredEmployees },
  });

  it("a sole proprietor without employees: the tax is reduced by own contributions in full", () => {
    const [m] = projectScenario(2027, 1, 1, [], 0, [service], extras(false));
    expect([m.taxReduction.toNumber(), m.tax.toNumber(), m.netProfit.toNumber()]).toEqual([1000, 5000, 94000]);
  });

  it("with a hire in the forecast or employees in the register: own and employee contributions, up to half of the tax", () => {
    const hire = [row(2027, 1, "headcount", 1), row(2027, 1, "avg_employee_cost", 30200)];
    const [hired] = projectScenario(2027, 1, 1, hire, 0, [service], extras(false));
    // Tax 6 000; contributions 1 000 own + 7 004,92 for the employee — limited to 3 000.
    expect([hired.taxReduction.toNumber(), hired.tax.toNumber()]).toEqual([3000, 3000]);
    const [registered] = projectScenario(2027, 1, 1, [], 0, [service], extras(true));
    expect([registered.taxReduction.toNumber(), registered.tax.toNumber()]).toEqual([1000, 5000]); // below the limit
  });
});

describe("projectScenario — VAT", () => {
  it("customers pay revenue plus VAT; VAT goes to the budget after the quarter; the profit does not change", () => {
    const service: NewServiceInput = { id: "s", name: "Услуга", launchYear: 2027, launchMonth: 1, avgCheck: 1000, salesPerMonth: 100, rampUpMonths: 0, variableCostPct: 0 };
    const p = projectScenario(2027, 1, 4, [], 0, [service], { vat: { rateForYear: () => new Decimal(22) } });
    expect(p[0].cashBalance.toNumber()).toBe(122000);
    expect(p[0].netProfit.toNumber()).toBe(100000);
    expect(p[3].vatPaid.toNumber()).toBe(22000);
    expect(p[3].cashBalance.toNumber()).toBe(4 * 122000 - 22000);
  });
});
