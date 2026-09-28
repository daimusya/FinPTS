import { prisma } from "@/lib/db";
import { toDecimal, sumMoney } from "@/lib/money";
import Decimal from "decimal.js";
import { PayrollRunKind } from "@prisma/client";
import {
  ABSENCE_DAY_TYPES,
  WORK_DAY_TYPES,
  computeExtraPay,
  computeProratedSalary,
  computeTripPay,
  scheduleRule,
  scheduledDays,
  toCalendarOverrides,
  type CalendarOverrides,
  type WorkScheduleRule,
} from "./work-calendar";
import { earningsMonth } from "./average-earnings";

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

/** Ошибка, которую нужно показать пользователю, а не превращать в 500. */
export class PayrollCalculationError extends Error {}

export async function calculatePayrollRun(runId: string, userId: string) {
  const run = await prisma.payrollRun.findUniqueOrThrow({
    where: { id: runId },
    include: { period: true },
  });

  const [employees, rates, advanceType, salaryType] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId: run.organizationId, status: "ACTIVE", salary: { not: null } },
      include: { projectAlloc: { where: { validTo: null } }, workSchedule: true },
    }),
    loadTaxRates(),
    prisma.payrollAccrualType.findFirstOrThrow({ where: { code: "advance" } }),
    prisma.payrollAccrualType.findFirstOrThrow({ where: { code: "salary" } }),
  ]);

  // Month the run pays for: the advance on the 25th — its own month, the final settlement on the 10th — the previous one.
  const shift = run.kind === PayrollRunKind.FINAL ? -1 : 0;
  const monthIndex = run.payoutDate.getUTCFullYear() * 12 + run.payoutDate.getUTCMonth() + shift;
  const workYear = Math.floor(monthIndex / 12);
  const workMonth = (monthIndex % 12) + 1;
  const monthStart = new Date(Date.UTC(workYear, workMonth - 1, 1));
  const monthEnd = new Date(Date.UTC(workYear, workMonth, 0));

  const [calendarRows, timesheetRows, extraTypes] = await Promise.all([
    // The previous year too: a business trip is paid by the average of the 12 months before it.
    prisma.productionCalendarDay.findMany({ where: { isArchived: false, date: { gte: new Date(Date.UTC(workYear - 1, 0, 1)), lte: new Date(Date.UTC(workYear, 11, 31)) } } }),
    prisma.timeSheet.findMany({
      where: {
        employeeId: { in: employees.map((e) => e.id) },
        date: { gte: monthStart, lte: monthEnd },
        dayType: { in: [...ABSENCE_DAY_TYPES, ...WORK_DAY_TYPES] },
      },
      select: { employeeId: true, date: true, dayType: true, hours: true },
    }),
    prisma.payrollAccrualType.findMany({ where: { code: { in: ["overtime_pay", "weekend_pay", "business_trip_pay"] }, isArchived: false } }),
  ]);
  const calendarYears = new Set(calendarRows.map((r) => r.date.getUTCFullYear()));
  if (!calendarYears.has(workYear) && run.kind !== PayrollRunKind.ADHOC) {
    // Checked before the old lines are deleted, so a failed recalculation leaves the run as it was.
    throw new PayrollCalculationError(
      `Производственный календарь на ${workYear} год не заполнен — добавьте праздники и переносы в справочнике «Производственный календарь»`,
    );
  }
  const calendar: CalendarOverrides = toCalendarOverrides(calendarRows);
  const timesheetByEmployee = new Map<string, Map<string, Set<string>>>();
  const hoursByEmployee = new Map<string, Map<string, Map<string, Decimal>>>();
  for (const row of timesheetRows) {
    const key = row.date.toISOString().slice(0, 10);
    const days = timesheetByEmployee.get(row.employeeId) ?? new Map<string, Set<string>>();
    days.set(key, (days.get(key) ?? new Set<string>()).add(row.dayType));
    timesheetByEmployee.set(row.employeeId, days);
    const hours = hoursByEmployee.get(row.employeeId) ?? new Map<string, Map<string, Decimal>>();
    const byType = hours.get(key) ?? new Map<string, Decimal>();
    byType.set(row.dayType, (byType.get(row.dayType) ?? toDecimal(0)).plus(toDecimal(row.hours)));
    hours.set(key, byType);
    hoursByEmployee.set(row.employeeId, hours);
  }
  const extraType = (code: string) => {
    const type = extraTypes.find((t) => t.code === code);
    if (!type) throw new PayrollCalculationError(`В справочнике «Виды начислений зарплаты» нет активного вида с кодом ${code}`);
    return type;
  };

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
  const createLine = async (
    employee: (typeof employees)[number],
    accrualType: { id: string; subjectToNdfl: boolean; subjectToInsurance: boolean },
    amount: Decimal,
    comment: string,
  ) => {
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
        comment,
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
  };

  for (const employee of employees) {
    if (run.kind === PayrollRunKind.ADHOC) continue; // ADHOC runs are filled manually via addPayrollLineAction

    const schedule = scheduleRule(employee.workSchedule);
    const salary = toDecimal(employee.salary!);
    const prorated = computeProratedSalary({
      salary,
      year: workYear,
      month: workMonth,
      part: run.kind === PayrollRunKind.ADVANCE ? "firstHalf" : "full",
      hireDate: employee.hireDate,
      terminationDate: employee.terminationDate,
      calendar,
      calendarYears,
      timesheet: timesheetByEmployee.get(employee.id) ?? new Map(),
      schedule,
    });

    if (run.kind === PayrollRunKind.ADVANCE) {
      if (prorated.amount.greaterThan(0)) await createLine(employee, advanceType, prorated.amount, prorated.comment);
      continue;
    }

    const alreadyPaid = advancesPaidByEmployee.get(employee.id) ?? toDecimal(0);
    const salaryAmount = prorated.amount.minus(alreadyPaid);
    let comment = prorated.comment;
    if (alreadyPaid.greaterThan(0)) comment += `; оклад за месяц ${prorated.amount.toFixed(2)} минус аванс ${alreadyPaid.toFixed(2)}`;
    if (salaryAmount.greaterThan(0)) await createLine(employee, salaryType, salaryAmount, comment);

    // Overtime and work on days off / holidays (ст. 152–153 ТК РФ) — paid with the monthly settlement.
    const extra = computeExtraPay({
      salary,
      year: workYear,
      month: workMonth,
      schedule,
      calendar,
      hireDate: employee.hireDate,
      terminationDate: employee.terminationDate,
      hours: hoursByEmployee.get(employee.id) ?? new Map(),
      workedRegularHours: prorated.workedHours,
    });
    const rate = `часовая ставка ${extra.hourlyRate.toFixed(2)} (оклад / ${extra.normHours.toString()} ч нормы)`;
    if (extra.overtime.amount.greaterThan(0)) {
      await createLine(
        employee,
        extraType("overtime_pay"),
        extra.overtime.amount,
        `Сверхурочные ${extra.overtime.hours.toString()} ч за ${extra.overtime.days} дн.: первые 2 ч в день × 1,5, остальные × 2; ${rate}`,
      );
    }
    if (extra.weekend.amount.greaterThan(0)) {
      const parts = [
        extra.weekend.withinNormHours.greaterThan(0) ? `${extra.weekend.withinNormHours.toString()} ч в пределах нормы × 1` : null,
        extra.weekend.beyondNormHours.greaterThan(0) ? `${extra.weekend.beyondNormHours.toString()} ч сверх нормы × 2` : null,
      ].filter(Boolean);
      await createLine(
        employee,
        extraType("weekend_pay"),
        extra.weekend.amount,
        `Работа в выходные и праздники, ${extra.weekend.days} дн. сверх оклада: ${parts.join(", ")}; ${rate}`,
      );
    }

    // Business trip days are not paid by the salary above — they are paid by the average earnings (ст. 167 ТК РФ).
    const tripDays = prorated.absentByType.business_trip ?? 0;
    if (tripDays > 0) {
      const trip = await tripAverage(employee, schedule, calendar, calendarYears, workYear, workMonth);
      const pay = computeTripPay({ tripDays, totalEarnings: trip.totalEarnings, workedDays: trip.workedDays, salary, monthNormDays: prorated.normDays });
      await createLine(
        employee,
        extraType("business_trip_pay"),
        pay.amount,
        pay.method === "average"
          ? `Командировка ${tripDays} раб. дн. × средний дневной ${pay.avgDaily.toFixed(2)} (${trip.totalEarnings.toFixed(2)} за 12 мес. / ${trip.workedDays} отработанных дн.)`
          : `Командировка ${tripDays} раб. дн. × оклад за день ${pay.avgDaily.toFixed(2)} (за 12 мес. нет заработка)`,
      );
    }
  }

  await prisma.payrollRun.update({ where: { id: runId }, data: { status: "CALCULATED" } });

  return { linesCreated };
}

/**
 * Заработок и фактически отработанные дни за 12 месяцев перед месяцем
 * командировки (п. 9 Положения № 922): утверждённые и выплаченные расчёты,
 * рабочие дни по графику сотрудника в пределах работы у нас минус дни
 * отпуска, болезни, командировок и отсутствия по табелю.
 */
async function tripAverage(
  employee: { id: string; hireDate: Date; terminationDate: Date | null },
  schedule: WorkScheduleRule,
  calendar: CalendarOverrides,
  calendarYears: Set<number>,
  workYear: number,
  workMonth: number,
): Promise<{ totalEarnings: Decimal; workedDays: number }> {
  const periodStart = new Date(Date.UTC(workYear, workMonth - 13, 1));
  const periodEnd = new Date(Date.UTC(workYear, workMonth - 1, 0));
  // Only the years of the period the employee actually worked here need a calendar.
  const countedFrom = new Date(Math.max(periodStart.getTime(), employee.hireDate.getTime()));
  const neededYears = countedFrom <= periodEnd ? [...new Set([countedFrom.getUTCFullYear(), periodEnd.getUTCFullYear()])] : [];
  const missing = neededYears.filter((y) => !calendarYears.has(y));
  if (missing.length > 0) {
    throw new PayrollCalculationError(
      `Для оплаты командировки по среднему нужен производственный календарь на ${missing.join(", ")} год — добавьте его в справочнике «Производственный календарь»`,
    );
  }

  const [lines, absences] = await Promise.all([
    prisma.payrollLine.findMany({
      where: { employeeId: employee.id, payrollRun: { status: { in: ["APPROVED", "PAID"] } }, accrualType: { affectsAvgEarnings: true } },
      include: { payrollRun: { select: { kind: true, payoutDate: true } } },
    }),
    prisma.timeSheet.findMany({
      where: { employeeId: employee.id, date: { gte: periodStart, lte: periodEnd }, dayType: { in: [...ABSENCE_DAY_TYPES, ...WORK_DAY_TYPES] } },
      select: { date: true, dayType: true },
    }),
  ]);
  let totalEarnings = toDecimal(0);
  for (const line of lines) {
    const { year, month } = earningsMonth(line.payrollRun.kind, line.payrollRun.payoutDate);
    const at = Date.UTC(year, month - 1, 1);
    if (at >= periodStart.getTime() && at <= periodEnd.getTime()) totalEarnings = totalEarnings.plus(toDecimal(line.amount));
  }
  const marks = new Map<string, Set<string>>();
  for (const a of absences) {
    const key = a.date.toISOString().slice(0, 10);
    marks.set(key, (marks.get(key) ?? new Set<string>()).add(a.dayType));
  }
  const from = new Date(Math.max(periodStart.getTime(), employee.hireDate.getTime()));
  const to = new Date(Math.min(periodEnd.getTime(), employee.terminationDate ? employee.terminationDate.getTime() : Infinity));
  let workedDays = 0;
  if (from <= to) {
    for (const day of scheduledDays(from, to, schedule, calendar)) {
      const m = marks.get(day);
      const worked = !m || WORK_DAY_TYPES.some((t) => m.has(t)) || !ABSENCE_DAY_TYPES.some((t) => m.has(t));
      if (worked) workedDays += 1;
    }
  }
  return { totalEarnings, workedDays };
}

