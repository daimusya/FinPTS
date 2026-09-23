import Decimal from "decimal.js";
import { sumMoney } from "@/lib/money";

export interface PayrollSummaryLine {
  organizationId: string;
  organizationName: string;
  departmentId: string | null;
  departmentName: string | null;
  projectId: string | null;
  projectName: string | null;
  employeeId: string;
  employeeName: string;
  paymentMethod: string;
  amount: Decimal;
  ndflAmount: Decimal;
  insuranceAmount: Decimal;
}

export interface PayrollSummaryBreakdownRow {
  key: string;
  name: string;
  net: Decimal;
}

export interface PayrollSummary {
  cashTotal: Decimal;
  bankTotal: Decimal;
  ndflTotal: Decimal;
  insuranceTotal: Decimal;
  grossTotal: Decimal;
  /** Начисленная сумма (включая удерживаемый НДФЛ) + страховые взносы сверх зарплаты. */
  cashNeedTotal: Decimal;
  byOrganization: PayrollSummaryBreakdownRow[];
  byDepartment: PayrollSummaryBreakdownRow[];
  byProject: PayrollSummaryBreakdownRow[];
  byEmployee: Array<PayrollSummaryBreakdownRow & { paymentMethod: string }>;
}

/**
 * Чистая агрегация сводной ведомости зарплаты, вынесена отдельно от
 * страницы и экспорта ради переиспользования и юнит-теста без БД.
 */
export function computePayrollSummary(lines: PayrollSummaryLine[]): PayrollSummary {
  const cashTotal = sumMoney(lines.filter((l) => l.paymentMethod === "CASH").map((l) => l.amount.minus(l.ndflAmount)));
  const bankTotal = sumMoney(lines.filter((l) => l.paymentMethod !== "CASH").map((l) => l.amount.minus(l.ndflAmount)));
  const ndflTotal = sumMoney(lines.map((l) => l.ndflAmount));
  const insuranceTotal = sumMoney(lines.map((l) => l.insuranceAmount));
  const grossTotal = sumMoney(lines.map((l) => l.amount));
  const cashNeedTotal = grossTotal.plus(insuranceTotal);

  const byOrg = new Map<string, PayrollSummaryBreakdownRow>();
  const byDept = new Map<string, PayrollSummaryBreakdownRow>();
  const byProject = new Map<string, PayrollSummaryBreakdownRow>();
  const byEmployee = new Map<string, PayrollSummaryBreakdownRow & { paymentMethod: string }>();

  for (const line of lines) {
    const net = line.amount.minus(line.ndflAmount);

    const orgRow = byOrg.get(line.organizationId);
    byOrg.set(line.organizationId, {
      key: line.organizationId,
      name: line.organizationName,
      net: (orgRow?.net ?? new Decimal(0)).plus(net),
    });

    const deptKey = line.departmentId ?? "none";
    const deptRow = byDept.get(deptKey);
    byDept.set(deptKey, {
      key: deptKey,
      name: line.departmentName ?? "Без подразделения",
      net: (deptRow?.net ?? new Decimal(0)).plus(net),
    });

    if (line.projectId) {
      const projRow = byProject.get(line.projectId);
      byProject.set(line.projectId, {
        key: line.projectId,
        name: line.projectName ?? "",
        net: (projRow?.net ?? new Decimal(0)).plus(net),
      });
    }

    const empRow = byEmployee.get(line.employeeId);
    byEmployee.set(line.employeeId, {
      key: line.employeeId,
      name: line.employeeName,
      net: (empRow?.net ?? new Decimal(0)).plus(net),
      paymentMethod: line.paymentMethod,
    });
  }

  return {
    cashTotal,
    bankTotal,
    ndflTotal,
    insuranceTotal,
    grossTotal,
    cashNeedTotal,
    byOrganization: Array.from(byOrg.values()),
    byDepartment: Array.from(byDept.values()),
    byProject: Array.from(byProject.values()),
    byEmployee: Array.from(byEmployee.values()),
  };
}
