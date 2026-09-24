import Decimal from "decimal.js";
import { toDecimal } from "@/lib/money";
import { computeBreakEven, computeMarginOfSafety } from "@/lib/reports/margin";
import type { DriverCode } from "./drivers";
import { loanSchedule, shiftByLag, type LoanInput, type LoanMonth } from "./cash-timing";

export interface ScenarioValueRow {
  year: number;
  month: number;
  driver: string;
  dimension: string | null;
  value: number | string | Decimal;
}

/** Новая услуга сценария (см. FinancialScenarioNewService в схеме). */
export interface NewServiceInput {
  id: string;
  name: string;
  launchYear: number;
  launchMonth: number;
  avgCheck: number | string | Decimal;
  salesPerMonth: number | string | Decimal;
  rampUpMonths: number;
  /** Свои переменные расходы услуги, % от её выручки; null — как у сценария. */
  variableCostPct: number | string | Decimal | null;
}

export interface NewServiceMonth {
  id: string;
  name: string;
  revenue: Decimal;
}

/**
 * Доля выхода новой услуги на полный объём в месяце monthsSinceLaunch
 * (0 — месяц запуска): при выходе за N месяцев — 1/N, 2/N, …, затем 1.
 * До запуска — 0.
 */
export function rampShare(monthsSinceLaunch: number, rampUpMonths: number): Decimal {
  if (monthsSinceLaunch < 0) return new Decimal(0);
  if (rampUpMonths <= 1) return new Decimal(1);
  return Decimal.min(new Decimal(monthsSinceLaunch + 1).dividedBy(rampUpMonths), 1);
}

export interface DepartmentHeadcount {
  departmentId: string;
  requiredHeadcount: number;
}

export interface MonthProjection {
  year: number;
  month: number;
  /** Выручка по драйверам сценария (средний чек × продажи × сезонность × корректировка). */
  baseRevenue: Decimal;
  /** Выручка новых услуг, запущенных к этому месяцу, — всего и по каждой. */
  newServicesRevenue: Decimal;
  newServices: NewServiceMonth[];
  revenue: Decimal;
  intermediaryCommission: Decimal;
  variableCosts: Decimal;
  fixedCosts: Decimal;
  payrollCost: Decimal;
  grossProfit: Decimal;
  operatingProfit: Decimal;
  departmentHeadcount: DepartmentHeadcount[];
  totalHeadcount: number;
  /** Проценты по кредитам из списка кредитов сценария — расход после операционной прибыли. */
  loanInterest: Decimal;
  /** Прибыль после процентов по кредитам. */
  netProfit: Decimal;
  /** Деньги от клиентов с учётом отсрочки оплаты. */
  collections: Decimal;
  /** Оплата переменных расходов и комиссии посредников с учётом отсрочки. */
  supplierPayments: Decimal;
  /** Текущая (фактическая) дебиторка и кредиторка — погашаются в первом месяце прогноза. */
  openingReceivableCollected: Decimal;
  openingPayablePaid: Decimal;
  loanDrawdown: Decimal;
  loanPrincipal: Decimal;
  /** Прочие платежи по кредитам и лизингу, заданные драйвером вручную. */
  manualLoanPayments: Decimal;
  loanDebt: Decimal;
  receivableEnd: Decimal;
  payableEnd: Decimal;
  cashBalance: Decimal;
  breakEvenRevenue: Decimal | null;
  marginOfSafetyPct: Decimal | null;
}

/** Остатки на старте прогноза и кредиты сценария — всё, что влияет на деньги, но не на драйверы. */
export interface ScenarioCashExtras {
  /** Фактическая дебиторка на сегодня. */
  openingReceivable?: number | string | Decimal;
  /** Фактическая кредиторка (включая зарплату к выплате) на сегодня. */
  openingPayable?: number | string | Decimal;
  loans?: LoanInput[];
}

const DEFAULT_100_DRIVERS = new Set<DriverCode>(["seasonality_pct", "new_service_activation_pct"]);

function addMonths(year: number, month: number, offset: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

class DriverLookup {
  private map = new Map<string, Decimal>();

  constructor(rows: ScenarioValueRow[]) {
    for (const row of rows) {
      const key = `${row.year}-${row.month}-${row.driver}-${row.dimension ?? ""}`;
      this.map.set(key, toDecimal(row.value));
    }
  }

  get(year: number, month: number, driver: DriverCode, dimension: string | null = null): Decimal {
    const key = `${year}-${month}-${driver}-${dimension ?? ""}`;
    const found = this.map.get(key);
    if (found !== undefined) return found;
    return toDecimal(DEFAULT_100_DRIVERS.has(driver) ? 100 : 0);
  }

  departmentDimensionsForMonth(year: number, month: number, driver: DriverCode): string[] {
    const prefix = `${year}-${month}-${driver}-`;
    const dims: string[] = [];
    for (const key of this.map.keys()) {
      if (key.startsWith(prefix)) {
        const dim = key.slice(prefix.length);
        if (dim) dims.push(dim);
      }
    }
    return dims;
  }
}

export function projectScenario(
  startYear: number,
  startMonth: number,
  months: number,
  rows: ScenarioValueRow[],
  startingCash: number | string | Decimal,
  newServices: NewServiceInput[] = [],
  extras: ScenarioCashExtras = {},
): MonthProjection[] {
  const lookup = new DriverLookup(rows);
  const results: MonthProjection[] = [];
  const customerLagDays: number[] = [];
  const supplierLagDays: number[] = [];
  const manualLoanPayments: Decimal[] = [];

  for (let i = 0; i < months; i += 1) {
    const { year, month } = addMonths(startYear, startMonth, i);

    const avgCheck = lookup.get(year, month, "avg_check");
    const salesCount = lookup.get(year, month, "sales_count");
    const seasonality = lookup.get(year, month, "seasonality_pct").dividedBy(100);
    const activation = lookup.get(year, month, "new_service_activation_pct").dividedBy(100);
    const baseRevenue = avgCheck.times(salesCount).times(seasonality).times(activation);

    const variableCostPct = lookup.get(year, month, "variable_cost_pct").dividedBy(100);
    const monthIndex = year * 12 + month;
    const serviceMonths: NewServiceMonth[] = [];
    let serviceVariableCosts = toDecimal(0);
    for (const service of newServices) {
      const share = rampShare(monthIndex - (service.launchYear * 12 + service.launchMonth), service.rampUpMonths);
      if (share.isZero()) continue;
      // The scenario seasonality applies to new services too; the base-revenue adjustment does not.
      const serviceRevenue = toDecimal(service.avgCheck).times(toDecimal(service.salesPerMonth)).times(share).times(seasonality);
      const servicePct = service.variableCostPct === null ? variableCostPct : toDecimal(service.variableCostPct).dividedBy(100);
      serviceVariableCosts = serviceVariableCosts.plus(serviceRevenue.times(servicePct));
      serviceMonths.push({ id: service.id, name: service.name, revenue: serviceRevenue });
    }
    const newServicesRevenue = serviceMonths.reduce((acc, s) => acc.plus(s.revenue), toDecimal(0));
    const revenue = baseRevenue.plus(newServicesRevenue);

    const intermediaryShare = lookup.get(year, month, "intermediary_share_pct").dividedBy(100);
    const intermediaryCommissionRate = lookup.get(year, month, "intermediary_commission_pct").dividedBy(100);
    const intermediaryCommission = revenue.times(intermediaryShare).times(intermediaryCommissionRate);

    const variableCosts = baseRevenue.times(variableCostPct).plus(serviceVariableCosts);

    const fixedCosts = lookup.get(year, month, "fixed_costs");

    const departmentIds = new Set([
      ...lookup.departmentDimensionsForMonth(year, month, "sales_count"),
      ...lookup.departmentDimensionsForMonth(year, month, "productivity_per_employee"),
    ]);
    const departmentHeadcount: DepartmentHeadcount[] = [];
    for (const departmentId of departmentIds) {
      const deptSales = lookup.get(year, month, "sales_count", departmentId);
      const productivity = lookup.get(year, month, "productivity_per_employee", departmentId);
      const required = productivity.greaterThan(0) ? deptSales.dividedBy(productivity).ceil().toNumber() : 0;
      departmentHeadcount.push({ departmentId, requiredHeadcount: required });
    }
    const manualHeadcount = lookup.get(year, month, "headcount").toNumber();
    const totalHeadcount = departmentHeadcount.reduce((acc, d) => acc + d.requiredHeadcount, 0) + manualHeadcount;

    const avgEmployeeCost = lookup.get(year, month, "avg_employee_cost");
    const payrollCost = avgEmployeeCost.times(totalHeadcount);

    const grossProfit = revenue.minus(variableCosts).minus(intermediaryCommission);
    const operatingProfit = grossProfit.minus(fixedCosts).minus(payrollCost);

    customerLagDays.push(lookup.get(year, month, "customer_payment_days").toNumber());
    supplierLagDays.push(lookup.get(year, month, "supplier_payment_days").toNumber());
    manualLoanPayments.push(lookup.get(year, month, "loan_payment"));

    const breakEvenRevenue = computeBreakEven(fixedCosts.plus(payrollCost), revenue, variableCosts.plus(intermediaryCommission));
    const marginOfSafetyPct = computeMarginOfSafety(revenue, breakEvenRevenue);

    results.push({
      year,
      month,
      baseRevenue,
      newServicesRevenue,
      newServices: serviceMonths,
      revenue,
      intermediaryCommission,
      variableCosts,
      fixedCosts,
      payrollCost,
      grossProfit,
      operatingProfit,
      departmentHeadcount,
      totalHeadcount,
      loanInterest: zero,
      netProfit: operatingProfit,
      collections: zero,
      supplierPayments: zero,
      openingReceivableCollected: zero,
      openingPayablePaid: zero,
      loanDrawdown: zero,
      loanPrincipal: zero,
      manualLoanPayments: zero,
      loanDebt: zero,
      receivableEnd: zero,
      payableEnd: zero,
      cashBalance: zero,
      breakEvenRevenue,
      marginOfSafetyPct,
    });
  }

  applyCashTiming(results, startYear, startMonth, toDecimal(startingCash), extras, {
    customerLagDays,
    supplierLagDays,
    manualLoanPayments,
  });
  return results;
}

const zero = new Decimal(0);

/**
 * Второй проход: деньги по месяцам. Выручка приходит с отсрочкой оплаты
 * клиентов, переменные расходы и комиссия уходят с отсрочкой оплаты
 * поставщикам, постоянные расходы и ФОТ — в том же месяце. Фактическая
 * дебиторка и кредиторка на сегодня гасятся в первом месяце. Кредиты из
 * списка: получение — приток, проценты — расход (прибыль после процентов) и
 * отток, основной долг — только отток.
 */
function applyCashTiming(
  results: MonthProjection[],
  startYear: number,
  startMonth: number,
  startingCash: Decimal,
  extras: ScenarioCashExtras,
  drivers: { customerLagDays: number[]; supplierLagDays: number[]; manualLoanPayments: Decimal[] },
) {
  const collections = shiftByLag(
    results.map((r) => r.revenue),
    drivers.customerLagDays,
  ).byMonth;
  const supplierPayments = shiftByLag(
    results.map((r) => r.variableCosts.plus(r.intermediaryCommission)),
    drivers.supplierLagDays,
  ).byMonth;
  const schedules = (extras.loans ?? []).map(loanSchedule);
  const startIndex = startYear * 12 + (startMonth - 1);
  // Debt of loans taken before the horizon starts: the balance after their last month before the start.
  let loanDebt = schedules.reduce((acc, s) => {
    const before = [...s.entries()].filter(([i]) => i < startIndex).sort((a, b) => a[0] - b[0]);
    return acc.plus(before.length > 0 ? before[before.length - 1][1].balance : zero);
  }, zero);

  let cash = startingCash;
  let receivable = toDecimal(extras.openingReceivable ?? 0);
  let payable = toDecimal(extras.openingPayable ?? 0);
  results.forEach((r, i) => {
    const index = startIndex + i;
    const months = schedules.map((s) => s.get(index)).filter((m): m is LoanMonth => Boolean(m));
    const drawdown = months.reduce((acc, m) => acc.plus(m.drawdown), zero);
    const interest = months.reduce((acc, m) => acc.plus(m.interest), zero);
    const principal = months.reduce((acc, m) => acc.plus(m.principal), zero);
    loanDebt = loanDebt.plus(drawdown).minus(principal);

    const openingReceivableCollected = i === 0 ? toDecimal(extras.openingReceivable ?? 0) : zero;
    const openingPayablePaid = i === 0 ? toDecimal(extras.openingPayable ?? 0) : zero;
    receivable = receivable.plus(r.revenue).minus(collections[i]).minus(openingReceivableCollected);
    payable = payable.plus(r.variableCosts).plus(r.intermediaryCommission).minus(supplierPayments[i]).minus(openingPayablePaid);

    cash = cash
      .plus(collections[i])
      .plus(openingReceivableCollected)
      .minus(supplierPayments[i])
      .minus(openingPayablePaid)
      .minus(r.fixedCosts)
      .minus(r.payrollCost)
      .minus(drivers.manualLoanPayments[i])
      .plus(drawdown)
      .minus(interest)
      .minus(principal);

    r.collections = collections[i];
    r.supplierPayments = supplierPayments[i];
    r.openingReceivableCollected = openingReceivableCollected;
    r.openingPayablePaid = openingPayablePaid;
    r.manualLoanPayments = drivers.manualLoanPayments[i];
    r.loanDrawdown = drawdown;
    r.loanInterest = interest;
    r.loanPrincipal = principal;
    r.loanDebt = loanDebt;
    r.netProfit = r.operatingProfit.minus(interest);
    r.receivableEnd = receivable;
    r.payableEnd = payable;
    r.cashBalance = cash;
  });
}
