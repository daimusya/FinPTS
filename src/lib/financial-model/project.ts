import Decimal from "decimal.js";
import { toDecimal } from "@/lib/money";
import { computeBreakEven, computeMarginOfSafety } from "@/lib/reports/margin";
import type { DriverCode } from "./drivers";

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
  cashBalance: Decimal;
  breakEvenRevenue: Decimal | null;
  marginOfSafetyPct: Decimal | null;
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
): MonthProjection[] {
  const lookup = new DriverLookup(rows);
  const results: MonthProjection[] = [];
  let cashBalance = toDecimal(startingCash);

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

    const loanPayment = lookup.get(year, month, "loan_payment");
    cashBalance = cashBalance.plus(operatingProfit).minus(loanPayment);

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
      cashBalance,
      breakEvenRevenue,
      marginOfSafetyPct,
    });
  }

  return results;
}
