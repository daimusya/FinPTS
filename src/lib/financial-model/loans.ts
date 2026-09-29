import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import { allocatedAsOf } from "@/lib/reports/balance-lines";
import { accrualScopeWhere, type AccessScope } from "@/lib/access-scope";
import type { LoanInput, LoanRepayment } from "./cash-timing";
import type { DueAmount, ScenarioCashExtras } from "./project";
import { combineTaxRates } from "@/lib/payroll/calculate";
import { DEFAULT_TAX_RATES, TAX_REGIME_LABELS, TAX_REGIMES, taxRate, type IpContributionParams, type TaxRateInput, type TaxRegime } from "./taxes";
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
  organization: { name: string; taxSystem: string; type?: string },
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
  const ipContribution = soleProprietorContributions(system, organization.type, rates);
  // Contributions (the payroll's share and a sole proprietor's own ones) reduce USN on income.
  const reduction =
    regime === "usn_income"
      ? {
          employeeInsuranceShare: employees.employeeInsurancePct.dividedBy(employees.employeeInsurancePct.plus(100)),
          registeredEmployees: employees.registeredEmployees > 0,
        }
      : null;
  const parts = [label];
  if (ipContribution) parts.push("взносы ИП за себя");
  if (reduction) {
    parts.push(
      employees.registeredEmployees > 0
        ? `налог уменьшается на страховые взносы не больше чем на 50% — есть сотрудники (${employees.registeredEmployees})`
        : organization.type === "SOLE_PROPRIETOR"
          ? "налог уменьшается на взносы ИП полностью, пока нет сотрудников (с найма — не больше 50%)"
          : "налог уменьшается на взносы за сотрудников прогноза не больше чем на 50%",
    );
  }
  return { regime, ratePct, label: parts.join("; "), ipContribution, reduction };
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
  scenario: { taxRegime: string; taxRatePct: { toString(): string } | null; taxOrganizationId: string | null },
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
        _count: { select: { employees: { where: { status: "ACTIVE" } } } },
      },
    });
    if (organization) {
      const rules = await prisma.taxRule.findMany({ where: { isArchived: false } });
      const { insurancePct } = combineTaxRates(rules, organization.taxRates, new Date(Date.UTC(startYear, 0, 1)));
      return organizationTax(
        { name: organization.shortName || organization.name, taxSystem: organization.taxSystem, type: organization.type },
        organization.taxRates,
        startYear,
        { registeredEmployees: organization._count.employees, employeeInsurancePct: insurancePct },
      );
    }
  }
  const regime = (TAX_REGIMES as string[]).includes(scenario.taxRegime) ? (scenario.taxRegime as TaxRegime) : "none";
  const rate = taxRate(regime, scenario.taxRatePct?.toString() ?? null);
  return {
    regime,
    ratePct: rate,
    label: regime === "none" ? TAX_REGIME_LABELS.none : `${TAX_REGIME_LABELS[regime]}, ${rate.toString().replace(".", ",")}%`,
    ipContribution: null,
    reduction: null,
  };
}
