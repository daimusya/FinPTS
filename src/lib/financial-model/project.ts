import Decimal from "decimal.js";
import { toDecimal } from "@/lib/money";
import { computeBreakEven, computeMarginOfSafety } from "@/lib/reports/margin";
import type { DriverCode } from "./drivers";
import { loanSchedule, shiftByLag, type LoanInput, type LoanMonth } from "./cash-timing";
import {
  activeShare,
  ipContributionOpening,
  usnVatExemptMonths,
  ipContributionSchedule,
  taxSchedule,
  vatSchedule,
  type IpContributionParams,
  type TaxRateInput,
  type TaxRegime,
  type VatParams,
  type YearOpening,
} from "./taxes";

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
  /** Персонал под услугу на полной мощности; набирается по мере выхода на мощность. */
  staffHeadcount?: number | null;
  /** Стоимость сотрудника услуги в месяц; null — средняя по сценарию (драйвер «Средняя стоимость сотрудника»). */
  staffCostPerEmployee?: number | string | Decimal | null;
  /** Постоянные расходы услуги в месяц — с месяца запуска. */
  monthlyFixedCosts?: number | string | Decimal | null;
  /** Разовые расходы на запуск — в месяц запуска. */
  launchCosts?: number | string | Decimal | null;
  /** Своя отсрочка оплаты клиентов услуги в днях; null — как у сценария. */
  customerPaymentDays?: number | null;
}

export interface NewServiceMonth {
  id: string;
  name: string;
  revenue: Decimal;
  variableCosts: Decimal;
  headcount: number;
  payrollCost: Decimal;
  /** Постоянные расходы услуги в месяц плюс, в месяц запуска, разовые расходы на запуск. */
  fixedCosts: Decimal;
  /** Вклад услуги в операционную прибыль: выручка − переменные − ФОТ − постоянные (без комиссии посредников). */
  contribution: Decimal;
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
  /** Прибыль после процентов, до налога. */
  profitBeforeTax: Decimal;
  /** Налог, начисленный в месяце (УСН или налог на прибыль, см. taxes.ts). */
  tax: Decimal;
  /** Чистая прибыль: после процентов и налога. */
  netProfit: Decimal;
  taxPaid: Decimal;
  taxPayableEnd: Decimal;
  /** На сколько в месяце уменьшен налог УСН «доходы» на страховые взносы (уже учтено в tax). */
  taxReduction: Decimal;
  /** Страховые взносы ИП за себя: начислено, уплачено, к уплате на конец месяца. */
  ipContribution: Decimal;
  ipContributionPaid: Decimal;
  ipContributionPayableEnd: Decimal;
  /** НДС: получен от клиентов, уплачен поставщикам, начислен к уплате, уплачен в бюджет, к уплате на конец месяца. */
  vatReceived: Decimal;
  vatPaidToSuppliers: Decimal;
  vatAccrued: Decimal;
  vatPaid: Decimal;
  vatPayableEnd: Decimal;
  /** Деньги от клиентов с учётом отсрочки оплаты. */
  collections: Decimal;
  /** Оплата переменных расходов и комиссии посредников с учётом отсрочки. */
  supplierPayments: Decimal;
  /** Текущая (фактическая) дебиторка и кредиторка — погашаются по своим срокам оплаты. */
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
  /**
   * Сроки погашения текущей дебиторки и кредиторки: месяц (год × 12 + месяц − 1)
   * и сумма. Просроченное — в первом месяце, после горизонта — остаётся долгом.
   * Не задано — всё в первом месяце.
   */
  openingReceivableDue?: DueAmount[];
  openingPayableDue?: DueAmount[];
  loans?: LoanInput[];
  tax?: { regime: TaxRegime; ratePct: TaxRateInput };
  /** Взносы ИП за себя — у прогноза «как у организации» для ИП. */
  ipContribution?: IpContributionParams | null;
  /**
   * Уменьшение налога УСН «доходы» на страховые взносы — у прогноза «как у
   * организации»: взносы ИП за себя и взносы за сотрудников (их доля в ФОТ
   * сценария); сотрудники есть, если они работают по справочнику или в
   * месяце прогноза численность больше нуля — тогда не больше 50 % налога.
   */
  taxReduction?: { employeeInsuranceShare: Decimal; registeredEmployees: boolean } | null;
  /** Факт с 1 января до начала прогноза — налог и взносы нарастающим итогом за весь год. */
  yearOpening?: YearOpening | null;
  /** НДС (ставка по годам); null — не считается. */
  vat?: VatParams | null;
  /**
   * Даты регистрации и прекращения деятельности организации: до регистрации
   * и после прекращения выручки, расходов, ФОТ и численности нет, неполный
   * месяц — пропорционально дням.
   */
  activeFrom?: Date | null;
  activeTo?: Date | null;
}

export interface DueAmount {
  index: number;
  amount: Decimal;
}

/** Сумма к погашению в каждом месяце горизонта; просроченное — в первом. */
export function spreadDue(due: DueAmount[] | undefined, total: Decimal, startIndex: number, months: number): Decimal[] {
  const byMonth = Array.from({ length: months }, () => new Decimal(0));
  if (months === 0) return byMonth;
  if (!due) {
    byMonth[0] = total;
    return byMonth;
  }
  for (const d of due) {
    const i = Math.max(0, d.index - startIndex);
    if (i < months) byMonth[i] = byMonth[i].plus(d.amount);
  }
  return byMonth;
}

const DEFAULT_100_DRIVERS = new Set<DriverCode>(["seasonality_pct", "new_service_activation_pct", "fixed_costs_vat_share_pct"]);

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
  // Revenue of new services with their own payment terms, by service: collected with that lag.
  const ownLagRevenue = new Map<string, { lag: number; amounts: Decimal[] }>();
  const supplierLagDays: number[] = [];
  const manualLoanPayments: Decimal[] = [];
  const fixedVatShares: Decimal[] = [];

  for (let i = 0; i < months; i += 1) {
    const { year, month } = addMonths(startYear, startMonth, i);

    const avgCheck = lookup.get(year, month, "avg_check");
    const salesCount = lookup.get(year, month, "sales_count");
    const seasonality = lookup.get(year, month, "seasonality_pct").dividedBy(100);
    const activation = lookup.get(year, month, "new_service_activation_pct").dividedBy(100);
    const baseRevenue = avgCheck.times(salesCount).times(seasonality).times(activation);

    const variableCostPct = lookup.get(year, month, "variable_cost_pct").dividedBy(100);
    const avgEmployeeCost = lookup.get(year, month, "avg_employee_cost");
    const monthIndex = year * 12 + month;
    const serviceMonths: NewServiceMonth[] = [];
    let serviceVariableCosts = toDecimal(0);
    let serviceHeadcount = 0;
    let servicePayroll = toDecimal(0);
    let serviceFixed = toDecimal(0);
    for (const service of newServices) {
      const sinceLaunch = monthIndex - (service.launchYear * 12 + service.launchMonth);
      const share = rampShare(sinceLaunch, service.rampUpMonths);
      if (share.isZero()) continue;
      // The scenario seasonality applies to new services too; the base-revenue adjustment does not.
      const serviceRevenue = toDecimal(service.avgCheck).times(toDecimal(service.salesPerMonth)).times(share).times(seasonality);
      const servicePct = service.variableCostPct === null ? variableCostPct : toDecimal(service.variableCostPct).dividedBy(100);
      const variable = serviceRevenue.times(servicePct);
      // Staff is hired as the service ramps up: the full headcount × the ramp share, rounded up.
      const headcount = service.staffHeadcount ? share.times(service.staffHeadcount).ceil().toNumber() : 0;
      const costPerEmployee = service.staffCostPerEmployee ? toDecimal(service.staffCostPerEmployee) : avgEmployeeCost;
      const payroll = costPerEmployee.times(headcount);
      const fixed = toDecimal(service.monthlyFixedCosts ?? 0).plus(sinceLaunch === 0 ? toDecimal(service.launchCosts ?? 0) : 0);
      serviceVariableCosts = serviceVariableCosts.plus(variable);
      serviceHeadcount += headcount;
      servicePayroll = servicePayroll.plus(payroll);
      serviceFixed = serviceFixed.plus(fixed);
      serviceMonths.push({
        id: service.id,
        name: service.name,
        revenue: serviceRevenue,
        variableCosts: variable,
        headcount,
        payrollCost: payroll,
        fixedCosts: fixed,
        contribution: serviceRevenue.minus(variable).minus(payroll).minus(fixed),
      });
    }
    for (const service of newServices) {
      if (service.customerPaymentDays === null || service.customerPaymentDays === undefined) continue;
      const entry = ownLagRevenue.get(service.id) ?? { lag: service.customerPaymentDays, amounts: [] };
      entry.amounts[i] = serviceMonths.find((m) => m.id === service.id)?.revenue ?? toDecimal(0);
      ownLagRevenue.set(service.id, entry);
    }
    const newServicesRevenue = serviceMonths.reduce((acc, s) => acc.plus(s.revenue), toDecimal(0));
    const revenue = baseRevenue.plus(newServicesRevenue);

    const intermediaryShare = lookup.get(year, month, "intermediary_share_pct").dividedBy(100);
    const intermediaryCommissionRate = lookup.get(year, month, "intermediary_commission_pct").dividedBy(100);
    const intermediaryCommission = revenue.times(intermediaryShare).times(intermediaryCommissionRate);

    const variableCosts = baseRevenue.times(variableCostPct).plus(serviceVariableCosts);

    const fixedCosts = lookup.get(year, month, "fixed_costs").plus(serviceFixed);

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
    const scenarioHeadcount = departmentHeadcount.reduce((acc, d) => acc + d.requiredHeadcount, 0) + manualHeadcount;
    const totalHeadcount = scenarioHeadcount + serviceHeadcount;
    const payrollCost = avgEmployeeCost.times(scenarioHeadcount).plus(servicePayroll);

    const grossProfit = revenue.minus(variableCosts).minus(intermediaryCommission);
    const operatingProfit = grossProfit.minus(fixedCosts).minus(payrollCost);

    customerLagDays.push(lookup.get(year, month, "customer_payment_days").toNumber());
    supplierLagDays.push(lookup.get(year, month, "supplier_payment_days").toNumber());
    manualLoanPayments.push(lookup.get(year, month, "loan_payment"));
    fixedVatShares.push(Decimal.min(1, Decimal.max(0, lookup.get(year, month, "fixed_costs_vat_share_pct").dividedBy(100))));

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
      profitBeforeTax: operatingProfit,
      tax: zero,
      netProfit: operatingProfit,
      taxPaid: zero,
      taxPayableEnd: zero,
      taxReduction: zero,
      ipContribution: zero,
      ipContributionPaid: zero,
      ipContributionPayableEnd: zero,
      vatReceived: zero,
      vatPaidToSuppliers: zero,
      vatAccrued: zero,
      vatPaid: zero,
      vatPayableEnd: zero,
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

  if (extras.activeFrom || extras.activeTo) limitToActivity(results, [...ownLagRevenue.values()], extras.activeFrom ?? null, extras.activeTo ?? null);

  applyCashTiming(results, startYear, startMonth, toDecimal(startingCash), extras, {
    customerLagDays,
    supplierLagDays,
    manualLoanPayments,
    ownLagRevenue: [...ownLagRevenue.values()],
    fixedVatShares,
  });
  return results;
}

/** Выручка, расходы, ФОТ и численность — только в дни деятельности организации (до регистрации и после прекращения — ноль). */
function limitToActivity(
  results: MonthProjection[],
  ownLagRevenue: Array<{ amounts: Decimal[] }>,
  from: Date | null,
  to: Date | null,
) {
  const round = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  results.forEach((r, i) => {
    const share = activeShare(r.year, r.month, from, to);
    if (share.equals(1)) return;
    const scale = (d: Decimal) => round(d.times(share));
    r.baseRevenue = scale(r.baseRevenue);
    r.newServices = r.newServices.map((sm) => ({
      ...sm,
      revenue: scale(sm.revenue),
      variableCosts: scale(sm.variableCosts),
      payrollCost: scale(sm.payrollCost),
      fixedCosts: scale(sm.fixedCosts),
      contribution: scale(sm.contribution),
      headcount: share.isZero() ? 0 : sm.headcount,
    }));
    r.newServicesRevenue = r.newServices.reduce((acc, sm) => acc.plus(sm.revenue), new Decimal(0));
    r.revenue = r.baseRevenue.plus(r.newServicesRevenue);
    r.intermediaryCommission = scale(r.intermediaryCommission);
    r.variableCosts = scale(r.variableCosts);
    r.fixedCosts = scale(r.fixedCosts);
    r.payrollCost = scale(r.payrollCost);
    r.grossProfit = r.revenue.minus(r.variableCosts).minus(r.intermediaryCommission);
    r.operatingProfit = r.grossProfit.minus(r.fixedCosts).minus(r.payrollCost);
    r.profitBeforeTax = r.operatingProfit;
    r.netProfit = r.operatingProfit;
    if (share.isZero()) {
      r.totalHeadcount = 0;
      r.departmentHeadcount = r.departmentHeadcount.map((dh) => ({ ...dh, requiredHeadcount: 0 }));
    }
    r.breakEvenRevenue = computeBreakEven(r.fixedCosts.plus(r.payrollCost), r.revenue, r.variableCosts.plus(r.intermediaryCommission));
    r.marginOfSafetyPct = computeMarginOfSafety(r.revenue, r.breakEvenRevenue);
    for (const service of ownLagRevenue) if (service.amounts[i]) service.amounts[i] = scale(service.amounts[i]);
  });
}

const zero = new Decimal(0);

/**
 * Второй проход: деньги по месяцам. Выручка приходит с отсрочкой оплаты
 * клиентов, переменные расходы и комиссия уходят с отсрочкой оплаты
 * поставщикам, постоянные расходы и ФОТ — в том же месяце; у новой услуги
 * может быть своя отсрочка клиентов. Фактическая дебиторка и кредиторка на
 * сегодня гасятся по своим срокам оплаты. Кредиты из списка: получение —
 * приток, проценты — расход и отток, основной долг — только отток. Налог —
 * по режиму сценария, уплата — по срокам (taxes.ts).
 */
function applyCashTiming(
  results: MonthProjection[],
  startYear: number,
  startMonth: number,
  startingCash: Decimal,
  extras: ScenarioCashExtras,
  drivers: {
    customerLagDays: number[];
    supplierLagDays: number[];
    manualLoanPayments: Decimal[];
    ownLagRevenue: Array<{ lag: number; amounts: Decimal[] }>;
    fixedVatShares: Decimal[];
  },
) {
  const ownLagTotal = (i: number) => drivers.ownLagRevenue.reduce((acc, s) => acc.plus(s.amounts[i] ?? zero), zero);
  const collections = shiftByLag(
    results.map((r, i) => r.revenue.minus(ownLagTotal(i))),
    drivers.customerLagDays,
  ).byMonth;
  for (const service of drivers.ownLagRevenue) {
    const shifted = shiftByLag(
      results.map((_, i) => service.amounts[i] ?? zero),
      results.map(() => service.lag),
    ).byMonth;
    shifted.forEach((amount, i) => (collections[i] = collections[i].plus(amount)));
  }
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

  const receivableDue = spreadDue(extras.openingReceivableDue, toDecimal(extras.openingReceivable ?? 0), startIndex, results.length);
  const payableDue = spreadDue(extras.openingPayableDue, toDecimal(extras.openingPayable ?? 0), startIndex, results.length);

  let cash = startingCash;
  let receivable = toDecimal(extras.openingReceivable ?? 0);
  let payable = toDecimal(extras.openingPayable ?? 0);
  const loanMonths = results.map((_, i) => {
    const months = schedules.map((s) => s.get(startIndex + i)).filter((m): m is LoanMonth => Boolean(m));
    return {
      drawdown: months.reduce((acc, m) => acc.plus(m.drawdown), zero),
      interest: months.reduce((acc, m) => acc.plus(m.interest), zero),
      principal: months.reduce((acc, m) => acc.plus(m.principal), zero),
    };
  });
  // USN counts money received and paid; profit tax counts the accrual-basis profit after interest.
  const taxBase = results.map((r, i) => ({
    year: r.year,
    month: r.month,
    income: collections[i].plus(receivableDue[i]),
    expenses: supplierPayments[i].plus(payableDue[i]).plus(r.fixedCosts).plus(r.payrollCost).plus(loanMonths[i].interest),
    profit: r.operatingProfit.minus(loanMonths[i].interest),
  }));
  const opening = extras.yearOpening ?? null;
  const contributions = extras.ipContribution ? ipContributionSchedule(extras.ipContribution, taxBase, opening) : null;
  const reduction = extras.taxReduction;
  // Own contributions for the months before the forecast also reduce USN on income for the year.
  const ownBefore = opening && extras.ipContribution ? ipContributionOpening(extras.ipContribution, opening) : null;
  const taxOpening = opening
    ? {
        ...opening,
        deductibleContributions: reduction && ownBefore ? ownBefore.fixed.plus(ownBefore.income) : opening.deductibleContributions,
        hasEmployees: reduction ? reduction.registeredEmployees || Boolean(opening.hasEmployees) : opening.hasEmployees,
      }
    : null;
  // USN is free of VAT while its income stays within the limit (from 2025).
  const usnRegime = extras.tax?.regime === "usn_income" || extras.tax?.regime === "usn_income_expense";
  const exempt =
    extras.vat?.usnExemption && usnRegime
      ? usnVatExemptMonths(
          taxBase.map((b) => ({ year: b.year, month: b.month, income: b.income })),
          extras.vat.usnExemption.previousYearIncome,
          opening ? { year: opening.year, income: opening.income } : null,
        )
      : null;
  const vat = extras.vat
    ? vatSchedule(
        extras.vat,
        results.map((r, i) => {
          // Fixed costs bought with input VAT are paid in the same month.
          const fixedWithVat = r.fixedCosts.times(drivers.fixedVatShares[i] ?? 1);
          return {
            year: r.year,
            month: r.month,
            revenue: r.revenue,
            purchases: r.variableCosts.plus(r.intermediaryCommission).plus(fixedWithVat),
            collections: collections[i],
            supplierPayments: supplierPayments[i].plus(fixedWithVat),
            exempt: exempt?.[i] ?? false,
          };
        }),
      )
    : null;
  const taxes = taxSchedule(
    extras.tax?.regime ?? "none",
    extras.tax?.ratePct ?? zero,
    taxBase.map((b, i) => {
      const own = contributions?.[i] ?? { accrued: zero, paid: zero };
      return {
        ...b,
        // Own contributions are an expense where the tax counts expenses (paid ones — the cash method).
        expenses: b.expenses.plus(own.paid),
        profit: b.profit.minus(own.accrued),
        deductibleContributions: reduction ? own.accrued.plus(results[i].payrollCost.times(reduction.employeeInsuranceShare)) : undefined,
        hasEmployees: reduction ? reduction.registeredEmployees || results[i].totalHeadcount > 0 : undefined,
      };
    }),
    taxOpening,
  );
  results.forEach((r, i) => {
    const { drawdown, interest, principal } = loanMonths[i];
    loanDebt = loanDebt.plus(drawdown).minus(principal);

    const openingReceivableCollected = receivableDue[i];
    const openingPayablePaid = payableDue[i];
    const tax = taxes[i];
    const contribution = contributions?.[i] ?? { accrued: zero, paid: zero, payableEnd: zero };
    const vatMonth = vat?.[i] ?? { received: zero, paidToSuppliers: zero, accrued: zero, paid: zero, payableEnd: zero };
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
      .minus(principal)
      .minus(tax.paid)
      .minus(contribution.paid)
      .plus(vatMonth.received)
      .minus(vatMonth.paidToSuppliers)
      .minus(vatMonth.paid);

    r.collections = collections[i];
    r.supplierPayments = supplierPayments[i];
    r.openingReceivableCollected = openingReceivableCollected;
    r.openingPayablePaid = openingPayablePaid;
    r.manualLoanPayments = drivers.manualLoanPayments[i];
    r.loanDrawdown = drawdown;
    r.loanInterest = interest;
    r.loanPrincipal = principal;
    r.loanDebt = loanDebt;
    r.profitBeforeTax = r.operatingProfit.minus(interest);
    r.tax = tax.accrued;
    r.netProfit = r.profitBeforeTax.minus(tax.accrued).minus(contribution.accrued);
    r.taxPaid = tax.paid;
    r.taxPayableEnd = tax.payableEnd;
    r.taxReduction = tax.reduction;
    r.ipContribution = contribution.accrued;
    r.ipContributionPaid = contribution.paid;
    r.ipContributionPayableEnd = contribution.payableEnd;
    r.vatReceived = vatMonth.received;
    r.vatPaidToSuppliers = vatMonth.paidToSuppliers;
    r.vatAccrued = vatMonth.accrued;
    r.vatPaid = vatMonth.paid;
    r.vatPayableEnd = vatMonth.payableEnd;
    r.receivableEnd = receivable;
    r.payableEnd = payable;
    r.cashBalance = cash;
  });
}
