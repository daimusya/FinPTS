import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computePayrollSummary, type PayrollSummaryLine } from "./summary";

function line(overrides: Partial<PayrollSummaryLine> = {}): PayrollSummaryLine {
  return {
    organizationId: "org1",
    organizationName: "Org 1",
    departmentId: "dept1",
    departmentName: "Dept 1",
    projectId: null,
    projectName: null,
    employeeId: "emp1",
    employeeName: "Иванов",
    paymentMethod: "BANK",
    amount: new Decimal(100000),
    ndflAmount: new Decimal(13000),
    insuranceAmount: new Decimal(30200),
    ...overrides,
  };
}

describe("computePayrollSummary", () => {
  it("splits cash vs bank net pay correctly", () => {
    const summary = computePayrollSummary([
      line({ employeeId: "emp1", paymentMethod: "CASH", amount: new Decimal(50000), ndflAmount: new Decimal(6500) }),
      line({ employeeId: "emp2", paymentMethod: "BANK", amount: new Decimal(100000), ndflAmount: new Decimal(13000) }),
    ]);
    expect(summary.cashTotal.toNumber()).toBe(43500);
    expect(summary.bankTotal.toNumber()).toBe(87000);
  });

  it("sums NDFL, insurance and computes total cash need (gross + insurance)", () => {
    const summary = computePayrollSummary([line({ amount: new Decimal(100000), ndflAmount: new Decimal(13000), insuranceAmount: new Decimal(30200) })]);
    expect(summary.ndflTotal.toNumber()).toBe(13000);
    expect(summary.insuranceTotal.toNumber()).toBe(30200);
    expect(summary.grossTotal.toNumber()).toBe(100000);
    expect(summary.cashNeedTotal.toNumber()).toBe(130200);
  });

  it("groups by organization, department and employee", () => {
    const summary = computePayrollSummary([
      line({ employeeId: "emp1", organizationId: "org1", organizationName: "Org 1", departmentId: "dept1", departmentName: "Dept 1" }),
      line({ employeeId: "emp2", organizationId: "org1", organizationName: "Org 1", departmentId: "dept2", departmentName: "Dept 2" }),
    ]);
    expect(summary.byOrganization).toHaveLength(1);
    expect(summary.byOrganization[0].net.toNumber()).toBe(174000);
    expect(summary.byDepartment).toHaveLength(2);
    expect(summary.byEmployee).toHaveLength(2);
  });

  it("groups by project only when a line has one, and labels missing department", () => {
    const summary = computePayrollSummary([
      line({ employeeId: "emp1", departmentId: null, departmentName: null, projectId: "proj1", projectName: "Project 1" }),
      line({ employeeId: "emp2", departmentId: null, departmentName: null, projectId: null, projectName: null }),
    ]);
    expect(summary.byProject).toHaveLength(1);
    expect(summary.byProject[0].name).toBe("Project 1");
    expect(summary.byDepartment.every((d) => d.name === "Без подразделения")).toBe(true);
  });
});
