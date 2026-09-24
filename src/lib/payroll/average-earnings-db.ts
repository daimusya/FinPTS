import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import {
  computeSickLeaveBenefit,
  computeVacationPay,
  earningsMonth,
  EXCLUDED_DAY_TYPES,
  monthKey,
  type InsuranceTenurePct,
  type SickLeaveResult,
  type VacationResult,
} from "./average-earnings";

export interface AverageEarningsRequest {
  kind: "vacation" | "sick";
  employeeId: string;
  startDate: Date;
  days: number;
  tenurePct: InsuranceTenurePct;
  /** Заработок у других работодателей за два года до года болезни (по справкам). */
  otherEmployers: [Decimal, Decimal];
}

/** Поля формы расчёта по среднему — общие для страницы (предпросмотр) и действия (добавление строки). */
export const AVERAGE_FIELDS = ["avgEmployeeId", "avgKind", "avgStart", "avgDays", "avgPct", "avgOther1", "avgOther2"] as const;
export type AverageParams = Partial<Record<(typeof AVERAGE_FIELDS)[number], string>>;

export function parseAverageRequest(params: AverageParams): { request: AverageEarningsRequest } | { error: string } {
  const kind = params.avgKind === "sick" ? "sick" : params.avgKind === "vacation" ? "vacation" : null;
  if (!kind) return { error: "Выберите, что рассчитать: отпускные или больничные" };
  if (!params.avgEmployeeId) return { error: "Выберите сотрудника" };
  if (!params.avgStart || !/^\d{4}-\d{2}-\d{2}$/.test(params.avgStart)) return { error: "Укажите дату начала" };
  const days = Number(params.avgDays);
  if (!Number.isInteger(days) || days < 1 || days > 366) return { error: "Число дней — целое от 1 до 366" };
  const pct = Number(params.avgPct ?? 100);
  if (kind === "sick" && pct !== 60 && pct !== 80 && pct !== 100) return { error: "Процент по страховому стажу — 60, 80 или 100" };
  const other = [params.avgOther1, params.avgOther2].map((raw) => {
    const cleaned = (raw ?? "").replace(/[\s ]/g, "").replace(",", ".");
    return cleaned === "" ? new Decimal(0) : new Decimal(Number.isNaN(Number(cleaned)) ? -1 : cleaned);
  });
  if (other.some((v) => v.isNegative())) return { error: "Заработок у других работодателей — неотрицательная сумма" };
  return {
    request: {
      kind,
      employeeId: params.avgEmployeeId,
      startDate: new Date(`${params.avgStart}T00:00:00.000Z`),
      days,
      tenurePct: (kind === "sick" ? pct : 100) as InsuranceTenurePct,
      otherEmployers: [other[0], other[1]],
    },
  };
}

export type AverageEarningsPreview = {
  employee: { id: string; fullName: string; organizationId: string; hireDate: Date; departmentId: string | null };
  /** Код вида начисления, которым строка попадёт в расчёт. */
  accrualCode: "vacation_pay" | "sick_leave_pay";
  /** Сумма строки расчёта: отпускные целиком, по больничному — только дни за счёт работодателя. */
  lineAmount: Decimal;
} & ({ kind: "vacation"; vacation: VacationResult } | { kind: "sick"; sick: SickLeaveResult });

/**
 * Считает отпускные или больничные по фактическим начислениям
 * сотрудника. Учитываются только утверждённые и выплаченные расчёты —
 * черновики ещё могут измениться.
 */
export async function computeAverageEarnings(request: AverageEarningsRequest): Promise<AverageEarningsPreview> {
  const employee = await prisma.employee.findUnique({ where: { id: request.employeeId } });
  if (!employee) throw new Error("Сотрудник не найден");
  if (request.startDate < new Date(Date.UTC(employee.hireDate.getUTCFullYear(), employee.hireDate.getUTCMonth(), employee.hireDate.getUTCDate()))) {
    throw new Error("Дата начала раньше даты приёма сотрудника");
  }

  const lines = await prisma.payrollLine.findMany({
    where: { employeeId: employee.id, payrollRun: { status: { in: ["APPROVED", "PAID"] } } },
    include: {
      payrollRun: { select: { kind: true, payoutDate: true } },
      accrualType: { select: { affectsAvgEarnings: true, subjectToInsurance: true } },
    },
  });
  const earningsOf = (line: (typeof lines)[number]) => earningsMonth(line.payrollRun.kind, line.payrollRun.payoutDate);
  const base = { id: employee.id, fullName: employee.fullName, organizationId: employee.organizationId, hireDate: employee.hireDate, departmentId: employee.departmentId };

  if (request.kind === "vacation") {
    const earningsByMonth = new Map<string, Decimal>();
    for (const line of lines) {
      if (!line.accrualType.affectsAvgEarnings) continue;
      const { year, month } = earningsOf(line);
      const key = monthKey(year, month);
      earningsByMonth.set(key, (earningsByMonth.get(key) ?? toDecimal(0)).plus(toDecimal(line.amount)));
    }
    const startYear = request.startDate.getUTCFullYear();
    const startMonth = request.startDate.getUTCMonth();
    const excluded = await prisma.timeSheet.findMany({
      where: {
        employeeId: employee.id,
        dayType: { in: [...EXCLUDED_DAY_TYPES] },
        date: { gte: new Date(Date.UTC(startYear, startMonth - 12, 1)), lt: new Date(Date.UTC(startYear, startMonth, 1)) },
      },
      select: { date: true },
    });
    const vacation = computeVacationPay({
      vacationStart: request.startDate,
      vacationDays: request.days,
      hireDate: employee.hireDate,
      earningsByMonth,
      excludedDates: new Set(excluded.map((t) => t.date.toISOString().slice(0, 10))),
      salary: employee.salary ? toDecimal(employee.salary) : null,
    });
    return { employee: base, kind: "vacation", vacation, accrualCode: "vacation_pay", lineAmount: vacation.amount };
  }

  const illnessYear = request.startDate.getUTCFullYear();
  const earningsByYear = new Map<number, Decimal>();
  for (const line of lines) {
    if (!line.accrualType.subjectToInsurance) continue;
    const { year } = earningsOf(line);
    earningsByYear.set(year, (earningsByYear.get(year) ?? toDecimal(0)).plus(toDecimal(line.amount)));
  }
  const parameters = await prisma.payrollParameter.findMany({
    where: { isArchived: false, year: { in: [illnessYear - 2, illnessYear - 1, illnessYear] } },
  });
  const limits = new Map(parameters.filter((p) => p.code === "insurance_base_limit").map((p) => [p.year, toDecimal(p.value)]));
  const mrot = parameters.find((p) => p.code === "mrot" && p.year === illnessYear);
  if (!mrot) {
    throw new Error(`Не задан МРОТ на ${illnessYear} год — добавьте его в справочнике «Параметры расчёта зарплаты»`);
  }
  const sick = computeSickLeaveBenefit({
    illnessStart: request.startDate,
    sickDays: request.days,
    tenurePct: request.tenurePct,
    earningsByYear,
    otherEmployersByYear: new Map([
      [illnessYear - 2, request.otherEmployers[0]],
      [illnessYear - 1, request.otherEmployers[1]],
    ]),
    baseLimitByYear: limits,
    mrot: toDecimal(mrot.value),
  });
  return { employee: base, kind: "sick", sick, accrualCode: "sick_leave_pay", lineAmount: sick.employerAmount };
}
