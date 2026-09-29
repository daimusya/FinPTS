import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import { allocatedAsOf } from "@/lib/reports/balance-lines";
import { accrualScopeWhere, type AccessScope } from "@/lib/access-scope";
import type { LoanInput, LoanRepayment } from "./cash-timing";
import type { DueAmount, ScenarioCashExtras } from "./project";
import { combineTaxRates } from "@/lib/payroll/calculate";
import {
  DEFAULT_TAX_RATES,
  TAX_REGIME_LABELS,
  TAX_REGIMES,
  taxRate,
  vatDeductible,
  type IpContributionParams,
  type TaxRateInput,
  type TaxRegime,
  type VatOpening,
  type VatParams,
  type YearOpening,
} from "./taxes";
import { computePnlReport } from "@/lib/reports/pnl";
import { accrualScopeWhere as accrualScope, bankTransactionScopeWhere, UNRESTRICTED_SCOPE } from "@/lib/access-scope";
import type { Prisma } from "@prisma/client";
import {
  ipFixedInsuranceAt,
  ipIncomeInsuranceAt,
  isTaxSystem,
  rateAt,
  TAX_SYSTEM_OPTIONS,
  type TaxKind,
  type TaxRateRecord,
  type TaxSystem,
} from "@/lib/organizations/taxes";

export const MAX_LOAN_TERM_MONTHS = 360;
const REPAYMENTS: LoanRepayment[] = ["annuity", "linear", "bullet"];

export interface LoanFormData {
  name: string;
  amount: Decimal;
  startYear: number;
  startMonth: number;
  annualRatePct: Decimal;
  termMonths: number;
  repayment: LoanRepayment;
  graceMonths: number;
  prepaymentYear: number | null;
  prepaymentMonth: number | null;
  prepaymentAmount: Decimal | null;
}

export const LOAN_FIELDS = ["name", "amount", "start", "annualRatePct", "termMonths", "repayment", "graceMonths", "prepayment", "prepaymentAmount"] as const;

function parseNumber(raw: string | undefined): Decimal | null {
  const cleaned = (raw ?? "").replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return new Decimal(cleaned);
}

export function parseLoanForm(raw: Record<string, string>): { data: LoanFormData } | { error: string } {
  const name = (raw.name ?? "").trim();
  if (!name) return { error: "Укажите название кредита" };
  const amount = parseNumber(raw.amount);
  if (!amount || amount.lessThanOrEqualTo(0)) return { error: "Сумма кредита — положительное число" };
  const start = (raw.start ?? "").match(/^(\d{4})-(\d{2})$/);
  const startMonth = start ? Number(start[2]) : 0;
  if (!start || startMonth < 1 || startMonth > 12) return { error: "Укажите месяц получения кредита" };
  const rate = parseNumber(raw.annualRatePct === "" ? "0" : raw.annualRatePct);
  if (!rate || rate.greaterThan(100)) return { error: "Ставка — от 0 до 100% годовых" };
  const termMonths = Number(raw.termMonths);
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > MAX_LOAN_TERM_MONTHS) {
    return { error: `Срок — целое число месяцев от 1 до ${MAX_LOAN_TERM_MONTHS}` };
  }
  const repayment = raw.repayment as LoanRepayment;
  if (!REPAYMENTS.includes(repayment)) return { error: "Выберите способ погашения" };

  const graceRaw = (raw.graceMonths ?? "").trim();
  const graceMonths = graceRaw === "" ? 0 : Number(graceRaw);
  if (!Number.isInteger(graceMonths) || graceMonths < 0 || graceMonths >= termMonths) {
    return { error: "Льготный период — целое число месяцев, меньше срока кредита" };
  }

  const startYear = Number(start[1]);
  const prepaymentRaw = (raw.prepayment ?? "").trim();
  const prepaymentAmountRaw = (raw.prepaymentAmount ?? "").trim();
  let prepaymentYear: number | null = null;
  let prepaymentMonth: number | null = null;
  let prepaymentAmount: Decimal | null = null;
  if (prepaymentRaw || prepaymentAmountRaw) {
    const when = prepaymentRaw.match(/^(\d{4})-(\d{2})$/);
    prepaymentAmount = parseNumber(prepaymentAmountRaw);
    if (!when || !prepaymentAmount || prepaymentAmount.lessThanOrEqualTo(0)) {
      return { error: "Досрочное погашение: укажите и месяц, и положительную сумму (или оставьте оба поля пустыми)" };
    }
    prepaymentYear = Number(when[1]);
    prepaymentMonth = Number(when[2]);
    const offset = prepaymentYear * 12 + prepaymentMonth - (startYear * 12 + startMonth);
    if (offset < 1 || offset > termMonths) return { error: "Досрочное погашение — в один из месяцев платежей по кредиту (после получения, в пределах срока)" };
  }
  return {
    data: { name, amount, startYear, startMonth, annualRatePct: rate, termMonths, repayment, graceMonths, prepaymentYear, prepaymentMonth, prepaymentAmount },
  };
}

/** Кредиты сценариев в виде входа для projectScenario, по id сценария. */
export async function loadLoans(scenarioIds: string[]): Promise<Map<string, LoanInput[]>> {
  const rows = await prisma.financialScenarioLoan.findMany({
    where: { scenarioId: { in: scenarioIds } },
    orderBy: [{ startYear: "asc" }, { startMonth: "asc" }, { name: "asc" }],
  });
  const byScenario = new Map<string, LoanInput[]>(scenarioIds.map((id) => [id, []]));
  for (const r of rows) {
    byScenario.get(r.scenarioId)?.push({
      id: r.id,
      name: r.name,
      amount: new Decimal(r.amount.toString()),
      startIndex: r.startYear * 12 + (r.startMonth - 1),
      annualRatePct: new Decimal(r.annualRatePct.toString()),
      termMonths: r.termMonths,
      repayment: r.repayment as LoanRepayment,
      graceMonths: r.graceMonths,
      prepayment:
        r.prepaymentYear && r.prepaymentMonth && r.prepaymentAmount
          ? { index: r.prepaymentYear * 12 + (r.prepaymentMonth - 1), amount: new Decimal(r.prepaymentAmount.toString()) }
          : null,
    });
  }
  return byScenario;
}

type OpeningBalances = Required<Pick<ScenarioCashExtras, "openingReceivable" | "openingPayable" | "openingReceivableDue" | "openingPayableDue">>;

/**
 * Фактические дебиторка и кредиторка (с зарплатой к выплате) на сегодня —
 * те же, что в управленческом балансе, с тем же ограничением видимости, —
 * по документам начисления с их сроками оплаты (срок не указан — дата
 * документа). Прогноз гасит каждый остаток в месяц его срока; просроченное —
 * в первом месяце.
 */
export async function loadOpeningBalances(scope: AccessScope, now = new Date()): Promise<OpeningBalances> {
  const docs = await prisma.accrualDocument.findMany({
    where: { status: "POSTED", date: { lte: now }, ...accrualScopeWhere(scope) },
    select: {
      date: true,
      dueDate: true,
      direction: true,
      lines: { select: { amount: true } },
      allocations: { where: { cancelledAt: null }, select: { amount: true, bankTransaction: { select: { operationDate: true } } } },
    },
  });
  const receivableDue: DueAmount[] = [];
  const payableDue: DueAmount[] = [];
  for (const doc of docs) {
    const paid = allocatedAsOf(
      doc.allocations.map((a) => ({ amount: toDecimal(a.amount), paymentDate: a.bankTransaction.operationDate, documentDate: doc.date })),
      now,
    );
    const remaining = sumMoney(doc.lines.map((l) => l.amount)).minus(paid);
    if (remaining.isZero()) continue;
    const due = doc.dueDate ?? doc.date;
    const item = { index: due.getUTCFullYear() * 12 + due.getUTCMonth(), amount: remaining };
    (doc.direction === "INCOME" ? receivableDue : payableDue).push(item);
  }
  return {
    openingReceivable: sumMoney(receivableDue.map((d) => d.amount)),
    openingPayable: sumMoney(payableDue.map((d) => d.amount)),
    openingReceivableDue: receivableDue,
    openingPayableDue: payableDue,
  };
}

/** Налог сценария: режим, ставка (по годам) и подпись для экрана. */
export interface ScenarioTax {
  regime: TaxRegime;
  ratePct: TaxRateInput;
  label: string;
  /** Взносы ИП за себя — только «как у организации» для ИП с такими ставками в карточке. */
  ipContribution: IpContributionParams | null;
  /** Уменьшение налога УСН «доходы» на страховые взносы — только «как у организации». */
  reduction: ScenarioCashExtras["taxReduction"];
  /** НДС: ставка по годам — из карточки организации или своя ставка сценария. */
  vat: VatParams | null;
  /** Организация, чей факт с начала года берётся для налога (null — все доступные). */
  organizationId: string | null;
  /** Даты регистрации и прекращения деятельности организации (только «как у организации»). */
  activeFrom: Date | null;
  activeTo: Date | null;
}

/** Для уменьшения налога: сотрудники по справочнику и ставка взносов за них (%, с травматизмом). */
export interface EmployeeTaxContext {
  registeredEmployees: number;
  employeeInsurancePct: Decimal;
}

/** Как система налогообложения организации считается в прогнозе и по какому налогу из её ставок. */
export const SYSTEM_REGIME: Record<TaxSystem, { regime: TaxRegime; kind: TaxKind | null }> = {
  osn: { regime: "profit", kind: "profit" },
  usn_income: { regime: "usn_income", kind: "usn" },
  usn_income_expense: { regime: "usn_income_expense", kind: "usn" },
  ausn_income: { regime: "ausn_income", kind: "ausn" },
  ausn_income_expense: { regime: "ausn_income_expense", kind: "ausn" },
  eshn: { regime: "eshn", kind: "eshn" },
  // The patent is a fixed cost, not a share of income or profit: set it as a fixed cost of the scenario.
  psn: { regime: "none", kind: null },
};

/**
 * Налог «как у организации»: режим — по её системе налогообложения, ставка
 * на каждый год — действующая на 1 января этого года по её ставкам (нет
 * ставки — стандартная для режима).
 */
export function organizationTax(
  organization: { name: string; taxSystem: string; type?: string; registrationDate?: Date | null; closureDate?: Date | null },
  rates: TaxRateRecord[],
  year: number,
  employees: EmployeeTaxContext = { registeredEmployees: 0, employeeInsurancePct: new Decimal(0) },
): ScenarioTax {
  const system: TaxSystem = isTaxSystem(organization.taxSystem) ? organization.taxSystem : "osn";
  const { regime, kind } = SYSTEM_REGIME[system];
  const ratePct = (y: number) => (kind ? rateAt(rates, kind, new Date(Date.UTC(y, 0, 1))) : null) ?? new Decimal(DEFAULT_TAX_RATES[regime]);
  const systemLabel = TAX_SYSTEM_OPTIONS.find((o) => o.value === system)!.label;
  const label =
    regime === "none"
      ? `как у «${organization.name}»: ${systemLabel} — налог в прогнозе не считается (стоимость патента задайте постоянными расходами)`
      : `как у «${organization.name}»: ${systemLabel}, ${ratePct(year).toString().replace(".", ",")}% в ${year} году`;
  const contributions = soleProprietorContributions(system, organization.type, rates);
  const ipContribution = contributions
    ? { ...contributions, activeFrom: organization.registrationDate ?? null, activeTo: organization.closureDate ?? null }
    : null;
  // AUSN and the patent are free of VAT; otherwise the VAT rate of the card, if any.
  const vatFree = system === "ausn_income" || system === "ausn_income_expense" || system === "psn";
  const vat: VatParams | null =
    vatFree || !rates.some((r) => r.taxKind === "vat")
      ? null
      : { rateForYear: (y) => rateAt(rates, "vat", new Date(Date.UTC(y, 0, 1))) };
  // Contributions (the payroll's share and a sole proprietor's own ones) reduce USN on income.
  const reduction =
    regime === "usn_income"
      ? {
          employeeInsuranceShare: employees.employeeInsurancePct.dividedBy(employees.employeeInsurancePct.plus(100)),
          registeredEmployees: employees.registeredEmployees > 0,
        }
      : null;
  const parts = [label];
  if (ipContribution) {
    const dates = [
      organization.registrationDate ? `с ${organization.registrationDate.toLocaleDateString("ru-RU", { timeZone: "UTC" })}` : null,
      organization.closureDate ? `по ${organization.closureDate.toLocaleDateString("ru-RU", { timeZone: "UTC" })}` : null,
    ].filter(Boolean);
    parts.push(`взносы ИП за себя${dates.length ? ` (деятельность ${dates.join(" ")})` : ""}`);
  }
  const vatNow = vat?.rateForYear(year);
  if (vatNow) parts.push(`НДС ${vatNow.toString().replace(".", ",")}%${vatDeductible(vatNow) ? " с вычетами" : " без вычетов"}`);
  if (reduction) {
    parts.push(
      employees.registeredEmployees > 0
        ? `налог уменьшается на страховые взносы не больше чем на 50% — есть сотрудники (${employees.registeredEmployees})`
        : organization.type === "SOLE_PROPRIETOR"
          ? "налог уменьшается на взносы ИП полностью, пока нет сотрудников (с найма — не больше 50%)"
          : "налог уменьшается на взносы за сотрудников прогноза не больше чем на 50%",
    );
  }
  return {
    regime,
    ratePct,
    label: parts.join("; "),
    ipContribution,
    reduction,
    vat,
    organizationId: null,
    activeFrom: organization.registrationDate ?? null,
    activeTo: organization.closureDate ?? null,
  };
}

/**
 * Взносы ИП за себя из карточки: фиксированные и с дохода свыше порога —
 * действующие на 1 января каждого года. На АУСН взносов за себя нет; на
 * патенте доход для взносов — потенциальный, его прогноз не знает, поэтому
 * там считаются только фиксированные.
 */
function soleProprietorContributions(system: TaxSystem, type: string | undefined, rates: TaxRateRecord[]): IpContributionParams | null {
  if (type !== "SOLE_PROPRIETOR" || system === "ausn_income" || system === "ausn_income_expense") return null;
  if (!rates.some((r) => r.taxKind === "ip_insurance_fixed" || r.taxKind === "ip_insurance_income")) return null;
  return {
    base: system === "usn_income" ? "income" : "income_minus_expenses",
    forYear: (y) => {
      const jan1 = new Date(Date.UTC(y, 0, 1));
      return { fixed: ipFixedInsuranceAt(rates, jan1), income: system === "psn" ? null : ipIncomeInsuranceAt(rates, jan1) };
    },
  };
}

/** Налог сценария для projectScenario: свой режим и ставка или «как у организации». */
export async function loadScenarioTax(
  scenario: { taxRegime: string; taxRatePct: { toString(): string } | null; taxOrganizationId: string | null; vatRatePct?: { toString(): string } | null },
  startYear: number,
): Promise<ScenarioTax> {
  if (scenario.taxRegime === "organization" && scenario.taxOrganizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: scenario.taxOrganizationId },
      select: {
        name: true,
        shortName: true,
        taxSystem: true,
        type: true,
        taxRates: true,
        registrationDate: true,
        closureDate: true,
        _count: { select: { employees: { where: { status: "ACTIVE" } } } },
      },
    });
    if (organization) {
      const rules = await prisma.taxRule.findMany({ where: { isArchived: false } });
      const { insurancePct } = combineTaxRates(rules, organization.taxRates, new Date(Date.UTC(startYear, 0, 1)));
      const tax = organizationTax(
        {
          name: organization.shortName || organization.name,
          taxSystem: organization.taxSystem,
          type: organization.type,
          registrationDate: organization.registrationDate,
          closureDate: organization.closureDate,
        },
        organization.taxRates,
        startYear,
        { registeredEmployees: organization._count.employees, employeeInsurancePct: insurancePct },
      );
      return { ...tax, organizationId: scenario.taxOrganizationId };
    }
  }
  const regime = (TAX_REGIMES as string[]).includes(scenario.taxRegime) ? (scenario.taxRegime as TaxRegime) : "none";
  const rate = taxRate(regime, scenario.taxRatePct?.toString() ?? null);
  const vatRate = scenario.vatRatePct ? new Decimal(scenario.vatRatePct.toString()) : null;
  const label = regime === "none" ? TAX_REGIME_LABELS.none : `${TAX_REGIME_LABELS[regime]}, ${rate.toString().replace(".", ",")}%`;
  return {
    regime,
    ratePct: rate,
    label: vatRate ? `${label}; НДС ${vatRate.toString().replace(".", ",")}%${vatDeductible(vatRate) ? " с вычетами" : " без вычетов"}` : label,
    ipContribution: null,
    reduction: null,
    vat: vatRate ? { rateForYear: () => vatRate } : null,
    organizationId: null,
    activeFrom: null,
    activeTo: null,
  };
}

/**
 * Факт с 1 января до начала прогноза (если прогноз начинается не с января):
 * поступления и платежи по банку и кассе (кроме переводов между своими
 * счетами и операций по статьям ДДС, привязанным к статьям баланса, —
 * займов, взносов в капитал) и прибыль до налога по ОПиУ. Берётся по
 * организации налога сценария или по всем доступным организациям, и только
 * по уже прошедшие дни.
 */
export async function loadYearOpening(
  startYear: number,
  startMonth: number,
  organizationId: string | null,
  scope: AccessScope = UNRESTRICTED_SCOPE,
  now: Date = new Date(),
): Promise<YearOpening | null> {
  const from = new Date(Date.UTC(startYear, 0, 1));
  const startDate = new Date(Date.UTC(startYear, startMonth - 1, 1));
  if (startMonth === 1 || from > now) return null;
  const until = new Date(Math.min(startDate.getTime() - 1, now.getTime()));

  const [flows, pnl] = await Promise.all([
    prisma.bankTransaction.groupBy({ by: ["direction"], where: operatingFlowsWhere(from, until, organizationId, scope), _sum: { amount: true } }),
    computePnlReport(
      { from, to: until, year: startYear, month: 1, label: "с начала года", span: "year" },
      organizationId ? { organizationId } : {},
      scope,
    ),
  ]);
  const sum = (direction: "INFLOW" | "OUTFLOW") => toDecimal(flows.find((f) => f.direction === direction)?._sum.amount?.toString() ?? 0);
  return {
    year: startYear,
    months: startMonth - 1,
    income: sum("INFLOW"),
    expenses: sum("OUTFLOW"),
    profit: pnl.netProfit.plus(pnl.tax),
  };
}

/** Операции банка и кассы, которые считаются доходом и расходом: без переводов между своими счетами и статей баланса. */
function operatingFlowsWhere(from: Date, until: Date, organizationId: string | null, scope: AccessScope): Prisma.BankTransactionWhereInput {
  const and: Prisma.BankTransactionWhereInput[] = [
    { operationDate: { gte: from, lte: until }, isTransfer: false },
    { OR: [{ cashFlowArticleId: null }, { cashFlowArticle: { balanceArticleId: null } }] },
  ];
  if (organizationId) and.push({ OR: [{ bankAccount: { organizationId } }, { cashAccount: { organizationId } }] });
  const scoped = bankTransactionScopeWhere(scope);
  if (Object.keys(scoped).length > 0) and.push(scoped);
  return { AND: and };
}

/**
 * НДС из проведённых документов начисления до начала прогноза: прошлый
 * квартал (его трети уплачиваются в месяцах квартала начала прогноза) и
 * месяцы квартала начала прогноза до него. «В т.ч. НДС» доходных документов —
 * исходящий, расходных — входящий. Плюс доход прошлого года по банку и
 * кассе — для освобождения от НДС на УСН.
 */
export async function loadVatOpening(
  startYear: number,
  startMonth: number,
  organizationId: string | null,
  scope: AccessScope = UNRESTRICTED_SCOPE,
  now: Date = new Date(),
): Promise<{ opening: VatOpening; previousYearIncome: Decimal }> {
  const startIndex = startYear * 12 + startMonth - 1;
  const quarterStart = startIndex - (startIndex % 3);
  const dateOf = (index: number) => new Date(Date.UTC(Math.floor(index / 12), index % 12, 1));
  const until = (index: number) => new Date(Math.min(dateOf(index).getTime() - 1, now.getTime()));
  const vatBetween = async (fromIndex: number, toIndex: number) => {
    const from = dateOf(fromIndex);
    if (fromIndex >= toIndex || from > now) return { output: new Decimal(0), input: new Decimal(0) };
    const docs = await prisma.accrualDocument.findMany({
      where: {
        status: "POSTED",
        date: { gte: from, lte: until(toIndex) },
        ...(organizationId ? { organizationId } : {}),
        ...accrualScope(scope),
      },
      select: { direction: true, lines: { select: { vatAmount: true } } },
    });
    let output = new Decimal(0);
    let input = new Decimal(0);
    for (const d of docs) {
      const vat = d.lines.reduce((acc, l) => acc.plus(l.vatAmount?.toString() ?? 0), new Decimal(0));
      if (d.direction === "INCOME") output = output.plus(vat);
      else input = input.plus(vat);
    }
    return { output, input };
  };
  const previousYearFrom = new Date(Date.UTC(startYear - 1, 0, 1));
  const [previousQuarter, currentQuarter, flows] = await Promise.all([
    vatBetween(quarterStart - 3, quarterStart),
    vatBetween(quarterStart, startIndex),
    previousYearFrom > now
      ? Promise.resolve([])
      : prisma.bankTransaction.aggregate({
          where: { AND: [operatingFlowsWhere(previousYearFrom, until(startYear * 12), organizationId, scope), { direction: "INFLOW" }] },
          _sum: { amount: true },
        }).then((r) => [r]),
  ]);
  const previousYearIncome = new Decimal(flows[0]?._sum.amount?.toString() ?? 0);
  return { opening: { previousQuarter, currentQuarter }, previousYearIncome };
}

/**
 * Всё, что прогнозу с налогом нужно из фактических данных: факт с начала
 * года (налог и взносы), НДС до начала прогноза и доход прошлого года
 * (освобождение на УСН), даты деятельности. Одно место для страницы
 * сценария, сравнения и выгрузки.
 */
export async function loadScenarioTaxContext(tax: ScenarioTax, startYear: number, startMonth: number, scope: AccessScope): Promise<Partial<ScenarioCashExtras>> {
  const taxOn = tax.regime !== "none" || Boolean(tax.ipContribution);
  const [yearOpening, vatContext] = await Promise.all([
    taxOn ? loadYearOpening(startYear, startMonth, tax.organizationId, scope) : null,
    tax.vat ? loadVatOpening(startYear, startMonth, tax.organizationId, scope) : null,
  ]);
  return {
    tax,
    ipContribution: tax.ipContribution,
    taxReduction: tax.reduction,
    yearOpening,
    vat: tax.vat && vatContext ? { ...tax.vat, opening: vatContext.opening, usnExemption: { previousYearIncome: vatContext.previousYearIncome } } : null,
    activeFrom: tax.activeFrom,
    activeTo: tax.activeTo,
  };
}
