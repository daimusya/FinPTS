import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import {
  computeSickLeaveBenefit,
  computeVacationPay,
  earningsMonth,
  EXCLUDED_DAY_TYPES,
  insuranceTenure,
  monthKey,
  type InsuranceTenurePct,
  type SalaryChange,
  type SickLeaveResult,
  type VacationResult,
} from "./average-earnings";

/** Страховой стаж для больничного: по данным системы или выбранный вручную. */
export type TenureMode = "auto" | "100" | "80" | "60" | "short";

export interface AverageEarningsRequest {
  kind: "vacation" | "sick";
  employeeId: string;
  startDate: Date;
  days: number;
  tenureMode: TenureMode;
  /** Заработок у других работодателей за два года перед годом болезни (по справкам). */
  otherEmployers: [Decimal, Decimal];
  /** То же за годы замены (по справкам) — эти годы свои, поэтому и справки свои. */
  otherEmployersReplaced: [Decimal, Decimal];
  /** Индексация отпускных при повышении окладов в организации / подразделении (п. 16 Положения № 922). */
  indexation: boolean;
  /** Замена лет расчётного периода больничного по заявлению сотрудника; null — два года перед годом болезни. */
  calcYears: [number, number] | null;
}

/** Поля формы расчёта по среднему — общие для страницы (предпросмотр) и действия (добавление строки). */
export const AVERAGE_FIELDS = [
  "avgEmployeeId",
  "avgKind",
  "avgStart",
  "avgDays",
  "avgPct",
  "avgOther1",
  "avgOther2",
  "avgIndex",
  "avgReplace",
  "avgYear1",
  "avgYear2",
  "avgOtherR1",
  "avgOtherR2",
] as const;
export type AverageParams = Partial<Record<(typeof AVERAGE_FIELDS)[number], string>>;

export function parseAverageRequest(params: AverageParams): { request: AverageEarningsRequest } | { error: string } {
  const kind = params.avgKind === "sick" ? "sick" : params.avgKind === "vacation" ? "vacation" : null;
  if (!kind) return { error: "Выберите, что рассчитать: отпускные или больничные" };
  if (!params.avgEmployeeId) return { error: "Выберите сотрудника" };
  if (!params.avgStart || !/^\d{4}-\d{2}-\d{2}$/.test(params.avgStart)) return { error: "Укажите дату начала" };
  const days = Number(params.avgDays);
  if (!Number.isInteger(days) || days < 1 || days > 366) return { error: "Число дней — целое от 1 до 366" };
  const tenureMode = (params.avgPct ?? "auto") as TenureMode;
  if (!["auto", "100", "80", "60", "short"].includes(tenureMode)) return { error: "Неизвестный вариант страхового стажа" };
  const other = [params.avgOther1, params.avgOther2, params.avgOtherR1, params.avgOtherR2].map((raw) => {
    const cleaned = (raw ?? "").replace(/[\s ]/g, "").replace(",", ".");
    return cleaned === "" ? new Decimal(0) : new Decimal(Number.isNaN(Number(cleaned)) ? -1 : cleaned);
  });
  if (other.some((v) => v.isNegative())) return { error: "Заработок у других работодателей — неотрицательная сумма" };

  const startDate = new Date(`${params.avgStart}T00:00:00.000Z`);
  let calcYears: [number, number] | null = null;
  if (kind === "sick" && params.avgReplace === "on") {
    const years = [Number(params.avgYear1), Number(params.avgYear2)].sort((a, b) => a - b) as [number, number];
    const illnessYear = startDate.getUTCFullYear();
    if (years.some((y) => !Number.isInteger(y) || y < illnessYear - 15 || y >= illnessYear)) {
      return { error: "Годы для замены — два прошедших календарных года до года болезни" };
    }
    if (years[0] === years[1]) return { error: "Годы расчётного периода должны быть разными" };
    calcYears = years;
  }

  return {
    request: {
      kind,
      employeeId: params.avgEmployeeId,
      startDate,
      days,
      tenureMode: kind === "sick" ? tenureMode : "100",
      otherEmployers: [other[0], other[1]],
      otherEmployersReplaced: [other[2], other[3]],
      indexation: kind === "vacation" && params.avgIndex === "on",
      calcYears,
    },
  };
}

export interface TenureInfo {
  mode: TenureMode;
  /** Стаж по данным системы, месяцев (null — выбран вручную). */
  months: number | null;
  /** Стаж до приёма указан в карточке сотрудника. */
  priorKnown: boolean;
  pct: InsuranceTenurePct;
  short: boolean;
}

export type AverageEarningsPreview = {
  employee: { id: string; fullName: string; organizationId: string; hireDate: Date; departmentId: string | null };
  /** Код вида начисления, которым строка попадёт в расчёт. */
  accrualCode: "vacation_pay" | "sick_leave_pay";
  /** Сумма строки расчёта: отпускные целиком, по больничному — только дни за счёт работодателя. */
  lineAmount: Decimal;
} & (
  | {
      kind: "vacation";
      vacation: VacationResult;
      /** Повышения оклада с начала расчётного периода по конец отпуска — подсказка для индексации. */
      raises: SalaryChange[];
      indexation: boolean;
    }
  | {
      kind: "sick";
      sick: SickLeaveResult;
      tenure: TenureInfo;
      /** Замена лет по заявлению: какие годы, пособие без замены и с ней, применена ли. */
      replacement: { years: [number, number]; standardTotal: Decimal; replacedTotal: Decimal; used: boolean } | null;
    }
);

/**
 * Считает отпускные или больничные по фактическим начислениям
 * сотрудника. Учитываются только утверждённые и выплаченные расчёты —
 * черновики ещё могут измениться.
 */
export async function computeAverageEarnings(request: AverageEarningsRequest): Promise<AverageEarningsPreview> {
  const employee = await prisma.employee.findUnique({ where: { id: request.employeeId }, include: { organization: true } });
  if (!employee) throw new Error("Сотрудник не найден");
  if (request.startDate < new Date(Date.UTC(employee.hireDate.getUTCFullYear(), employee.hireDate.getUTCMonth(), employee.hireDate.getUTCDate()))) {
    throw new Error("Дата начала раньше даты приёма сотрудника");
  }

  const lines = await prisma.payrollLine.findMany({
    where: { employeeId: employee.id, payrollRun: { status: { in: ["APPROVED", "PAID"] } } },
    include: {
      payrollRun: { select: { kind: true, payoutDate: true } },
      accrualType: { select: { affectsAvgEarnings: true, subjectToInsurance: true, indexable: true } },
    },
  });
  const earningsOf = (line: (typeof lines)[number]) => earningsMonth(line.payrollRun.kind, line.payrollRun.payoutDate);
  const base = { id: employee.id, fullName: employee.fullName, organizationId: employee.organizationId, hireDate: employee.hireDate, departmentId: employee.departmentId };

  if (request.kind === "vacation") {
    const earningsByMonth = new Map<string, Decimal>();
    const indexableByMonth = new Map<string, Decimal>();
    for (const line of lines) {
      if (!line.accrualType.affectsAvgEarnings) continue;
      const { year, month } = earningsOf(line);
      const key = monthKey(year, month);
      earningsByMonth.set(key, (earningsByMonth.get(key) ?? toDecimal(0)).plus(toDecimal(line.amount)));
      if (line.accrualType.indexable) indexableByMonth.set(key, (indexableByMonth.get(key) ?? toDecimal(0)).plus(toDecimal(line.amount)));
    }
    const startYear = request.startDate.getUTCFullYear();
    const startMonth = request.startDate.getUTCMonth();
    const periodStart = new Date(Date.UTC(startYear, startMonth - 12, 1));
    const vacationEnd = new Date(request.startDate.getTime() + (request.days - 1) * 86_400_000);
    const [excluded, history] = await Promise.all([
      prisma.timeSheet.findMany({
        where: {
          employeeId: employee.id,
          dayType: { in: [...EXCLUDED_DAY_TYPES] },
          date: { gte: periodStart, lt: new Date(Date.UTC(startYear, startMonth, 1)) },
        },
        select: { date: true },
      }),
      prisma.employmentHistory.findMany({ where: { employeeId: employee.id, eventType: "salary_change", toSalary: { not: null } }, orderBy: { eventDate: "asc" } }),
    ]);
    const changes: SalaryChange[] = history.map((h) => ({
      date: h.eventDate,
      from: h.fromSalary ? toDecimal(h.fromSalary) : null,
      to: toDecimal(h.toSalary!),
    }));
    const vacation = computeVacationPay({
      vacationStart: request.startDate,
      vacationDays: request.days,
      hireDate: employee.hireDate,
      earningsByMonth,
      excludedDates: new Set(excluded.map((t) => t.date.toISOString().slice(0, 10))),
      salary: employee.salary ? toDecimal(employee.salary) : null,
      indexation: request.indexation ? { changes, indexableByMonth } : undefined,
    });
    const raises = changes.filter((c) => c.date >= periodStart && c.date <= vacationEnd && (!c.from || c.to.greaterThan(c.from)));
    return { employee: base, kind: "vacation", vacation, raises, indexation: request.indexation, accrualCode: "vacation_pay", lineAmount: vacation.amount };
  }

  const illnessYear = request.startDate.getUTCFullYear();
  const earningsByYear = new Map<number, Decimal>();
  for (const line of lines) {
    if (!line.accrualType.subjectToInsurance) continue;
    const { year } = earningsOf(line);
    earningsByYear.set(year, (earningsByYear.get(year) ?? toDecimal(0)).plus(toDecimal(line.amount)));
  }
  const standardYears: [number, number] = [illnessYear - 2, illnessYear - 1];
  const neededYears = [...new Set([...standardYears, ...(request.calcYears ?? []), illnessYear])];
  const parameters = await prisma.payrollParameter.findMany({ where: { isArchived: false, year: { in: neededYears } } });
  const limits = new Map(parameters.filter((p) => p.code === "insurance_base_limit").map((p) => [p.year, toDecimal(p.value)]));
  const mrot = parameters.find((p) => p.code === "mrot" && p.year === illnessYear);
  if (!mrot) {
    throw new Error(`Не задан МРОТ на ${illnessYear} год — добавьте его в справочнике «Параметры расчёта зарплаты»`);
  }

  // Insurance tenure: from the system (prior tenure on the employee card + months here) unless chosen by hand.
  const auto = insuranceTenure(employee.priorInsuranceMonths ?? 0, employee.hireDate, request.startDate);
  const tenure: TenureInfo =
    request.tenureMode === "auto"
      ? { mode: "auto", months: auto.months, priorKnown: employee.priorInsuranceMonths !== null, pct: auto.pct, short: auto.short }
      : request.tenureMode === "short"
        ? { mode: "short", months: null, priorKnown: employee.priorInsuranceMonths !== null, pct: 60, short: true }
        : { mode: request.tenureMode, months: null, priorKnown: employee.priorInsuranceMonths !== null, pct: Number(request.tenureMode) as InsuranceTenurePct, short: false };

  const benefitFor = (years: [number, number], others: [Decimal, Decimal]) =>
    computeSickLeaveBenefit({
      illnessStart: request.startDate,
      sickDays: request.days,
      tenurePct: tenure.pct,
      shortTenure: tenure.short,
      calcYears: years,
      earningsByYear,
      otherEmployersByYear: new Map([
        [years[0], others[0]],
        [years[1], others[1]],
      ]),
      baseLimitByYear: limits,
      mrot: toDecimal(mrot.value),
      districtCoef: employee.organization.districtCoefficient ? toDecimal(employee.organization.districtCoefficient) : undefined,
    });

  const standard = benefitFor(standardYears, request.otherEmployers);
  let sick = standard;
  let replacement: Extract<AverageEarningsPreview, { kind: "sick" }>["replacement"] = null;
  if (request.calcYears && (request.calcYears[0] !== standardYears[0] || request.calcYears[1] !== standardYears[1])) {
    const replaced = benefitFor(request.calcYears, request.otherEmployersReplaced);
    // By law the years are replaced only if this increases the benefit.
    const used = replaced.total.greaterThan(standard.total);
    replacement = { years: request.calcYears, standardTotal: standard.total, replacedTotal: replaced.total, used };
    if (used) sick = replaced;
  }
  return { employee: base, kind: "sick", sick, tenure, replacement, accrualCode: "sick_leave_pay", lineAmount: sick.employerAmount };
}
