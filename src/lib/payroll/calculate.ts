import { prisma } from "@/lib/db";
import { toDecimal, sumMoney } from "@/lib/money";
import Decimal from "decimal.js";
import { PayrollRunKind } from "@prisma/client";

export interface TaxRates {
  ndflPct: Decimal;
  insurancePct: Decimal;
}

export async function loadTaxRates(): Promise<TaxRates> {
  const rules = await prisma.taxRule.findMany({ where: { isArchived: false } });
  const byBase = new Map(rules.map((r) => [r.base, toDecimal(r.ratePct)]));
  const ndflPct = byBase.get("ndfl") ?? toDecimal(0);
  const insurancePct = ["pension", "medical", "social", "injury"]
    .map((b) => byBase.get(b) ?? toDecimal(0))
    .reduce((acc, v) => acc.plus(v), toDecimal(0));
  return { ndflPct, insurancePct };
}

export function computeTaxes(
  amount: Decimal,
  subjectToNdfl: boolean,
  subjectToInsurance: boolean,
  rates: TaxRates,
): { ndflAmount: Decimal; insuranceAmount: Decimal } {
  return {
    ndflAmount: subjectToNdfl ? amount.times(rates.ndflPct).dividedBy(100) : toDecimal(0),
    insuranceAmount: subjectToInsurance ? amount.times(rates.insurancePct).dividedBy(100) : toDecimal(0),
  };
}

/**
 * Распределяет сумму начисления по активным проектным долям сотрудника.
 * Если долей нет — 100% уходит на подразделение сотрудника (или без
 * подразделения, если оно не задано).
 */
export function splitByProjectShares(
  amount: Decimal,
  shares: Array<{ projectId: string; sharePct: Decimal }>,
  fallbackDepartmentId: string | null,
): Array<{ projectId: string | null; departmentId: string | null; sharePct: Decimal; amount: Decimal }> {
  if (shares.length === 0) {
    return [{ projectId: null, departmentId: fallbackDepartmentId, sharePct: toDecimal(100), amount }];
  }

  const totalPct = sumMoney(shares.map((s) => s.sharePct));
  const normalized = totalPct.greaterThan(0) ? shares : shares.map((s) => ({ ...s, sharePct: toDecimal(100 / shares.length) }));
  const effectiveTotal = totalPct.greaterThan(0) ? totalPct : toDecimal(100);

  let allocated = toDecimal(0);
  const result = normalized.map((s, idx) => {
    const isLast = idx === normalized.length - 1;
    const lineAmount = isLast ? amount.minus(allocated) : amount.times(s.sharePct).dividedBy(effectiveTotal);
    allocated = allocated.plus(lineAmount);
    return { projectId: s.projectId, departmentId: null, sharePct: s.sharePct, amount: lineAmount };
  });
  return result;
}

export async function calculatePayrollRun(runId: string, userId: string) {
  const run = await prisma.payrollRun.findUniqueOrThrow({
    where: { id: runId },
    include: { period: true },
  });

  const [employees, rates, advanceType, salaryType] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId: run.organizationId, status: "ACTIVE", salary: { not: null } },
      include: { projectAlloc: { where: { validTo: null } } },
    }),
    loadTaxRates(),
    prisma.payrollAccrualType.findFirstOrThrow({ where: { code: "advance" } }),
    prisma.payrollAccrualType.findFirstOrThrow({ where: { code: "salary" } }),
  ]);

  await prisma.payrollLine.deleteMany({ where: { payrollRunId: runId } });

  let advancesPaidByEmployee = new Map<string, Decimal>();
  if (run.kind === PayrollRunKind.FINAL) {
    // Окончательный расчёт 10 числа закрывает работу ЗА ПРЕДЫДУЩИЙ месяц,
    // аванс за который выплачивался 25 числа того предыдущего месяца —
    // это разные учётные периоды, поэтому ищем по календарному месяцу даты
    // выплаты финального расчёта минус один месяц, а не по periodId.
    const finalMonth = run.payoutDate.getUTCMonth();
    const finalYear = run.payoutDate.getUTCFullYear();
    const advanceMonthStart = new Date(Date.UTC(finalYear, finalMonth - 1, 1));
    const advanceMonthEnd = new Date(Date.UTC(finalYear, finalMonth, 0, 23, 59, 59, 999));
    const advanceRun = await prisma.payrollRun.findFirst({
      where: {
        organizationId: run.organizationId,
        kind: PayrollRunKind.ADVANCE,
        payoutDate: { gte: advanceMonthStart, lte: advanceMonthEnd },
      },
      orderBy: { payoutDate: "desc" },
      include: { lines: { where: { accrualTypeId: advanceType.id } } },
    });
    if (advanceRun) {
      advancesPaidByEmployee = new Map(advanceRun.lines.map((l) => [l.employeeId, toDecimal(l.amount)]));
    }
  }

  let linesCreated = 0;

  for (const employee of employees) {
    const salary = toDecimal(employee.salary!);
    let amount: Decimal;
    let accrualType: { id: string; subjectToNdfl: boolean; subjectToInsurance: boolean };

    if (run.kind === PayrollRunKind.ADVANCE) {
      amount = salary.times(0.5).toDecimalPlaces(2);
      accrualType = advanceType;
    } else if (run.kind === PayrollRunKind.FINAL) {
      const alreadyPaid = advancesPaidByEmployee.get(employee.id) ?? toDecimal(0);
      amount = salary.minus(alreadyPaid);
      accrualType = salaryType;
    } else {
      continue; // ADHOC runs are filled manually via addPayrollLineAction
    }

    if (amount.lessThanOrEqualTo(0)) continue;

    const { ndflAmount, insuranceAmount } = computeTaxes(amount, accrualType.subjectToNdfl, accrualType.subjectToInsurance, rates);

    const line = await prisma.payrollLine.create({
      data: {
        payrollRunId: runId,
        employeeId: employee.id,
        accrualTypeId: accrualType.id,
        departmentId: employee.departmentId,
        amount,
        ndflAmount,
        insuranceAmount,
      },
    });

    const shares = employee.projectAlloc.map((a) => ({ projectId: a.projectId, sharePct: toDecimal(a.sharePct) }));
    const splits = splitByProjectShares(amount, shares, employee.departmentId);
    await prisma.payrollAllocation.createMany({
      data: splits.map((s) => ({
        payrollLineId: line.id,
        departmentId: s.departmentId ?? employee.departmentId,
        projectId: s.projectId,
        sharePct: s.sharePct,
        amount: s.amount,
      })),
    });

    linesCreated += 1;
  }

  await prisma.payrollRun.update({ where: { id: runId }, data: { status: "CALCULATED" } });

  return { linesCreated };
}
