import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import { allocatedAsOf } from "@/lib/reports/balance-lines";
import { accrualScopeWhere, type AccessScope } from "@/lib/access-scope";
import type { LoanInput, LoanRepayment } from "./cash-timing";
import type { DueAmount, ScenarioCashExtras } from "./project";
import { TAX_REGIMES, taxRate, type TaxRegime } from "./taxes";

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

/** Налоговый режим сценария для projectScenario. */
export function scenarioTax(scenario: { taxRegime: string; taxRatePct: { toString(): string } | null }): ScenarioCashExtras["tax"] {
  const regime = (TAX_REGIMES as string[]).includes(scenario.taxRegime) ? (scenario.taxRegime as TaxRegime) : "none";
  return { regime, ratePct: taxRate(regime, scenario.taxRatePct?.toString() ?? null) };
}
