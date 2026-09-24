import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { computeManagementBalance } from "@/lib/reports/balance";
import type { AccessScope } from "@/lib/access-scope";
import type { LoanInput, LoanRepayment } from "./cash-timing";
import type { ScenarioCashExtras } from "./project";

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
}

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
  return { data: { name, amount, startYear: Number(start[1]), startMonth, annualRatePct: rate, termMonths, repayment } };
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
    });
  }
  return byScenario;
}

/**
 * Фактические дебиторка и кредиторка на сегодня (из управленческого
 * баланса, с тем же ограничением видимости, что и стартовый остаток денег) —
 * прогноз считает, что они погасятся в первом месяце.
 */
export async function loadOpeningBalances(scope: AccessScope): Promise<Pick<ScenarioCashExtras, "openingReceivable" | "openingPayable">> {
  const balance = await computeManagementBalance(new Date(), {}, scope);
  return {
    openingReceivable: balance.receivable,
    openingPayable: balance.payable.plus(balance.payrollPayable),
  };
}
