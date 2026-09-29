import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";
import { isTaxSystem, rateAt, type TaxRateRecord } from "@/lib/organizations/taxes";
import { vatDeductible } from "@/lib/financial-model/taxes";

/**
 * Сумма строки документа начисления хранится с НДС («Сумма», «в т.ч. НДС»).
 * В доходы и расходы (ОПиУ, маржинальность, прибыль в балансе, результат
 * проекта) идёт сумма без НДС: у доходов НДС вычитается всегда — это не
 * выручка, а налог к уплате; у расходов — только если организация
 * принимает входящий НДС к вычету, иначе он часть расхода. Долги (дебиторка,
 * кредиторка, оплаты) остаются с НДС: платят всю сумму.
 */
export function lineNetAmount(
  line: { amount: Decimal | string | number | { toString(): string }; vatAmount?: Decimal | string | number | { toString(): string } | null },
  direction: "INCOME" | "EXPENSE",
  inputVatDeductible: boolean,
): Decimal {
  const amount = toDecimal(line.amount.toString());
  const vat = line.vatAmount ? toDecimal(line.vatAmount.toString()) : toDecimal(0);
  return direction === "INCOME" || inputVatDeductible ? amount.minus(vat) : amount;
}

/**
 * Принимает ли организация входящий НДС к вычету на дату: на ОСН — да; на
 * УСН и ЕСХН — если в карточке на эту дату есть ставка НДС с вычетами (22 %,
 * 10 %), при специальных 5 % и 7 % или без ставки — нет; на АУСН и патенте —
 * нет.
 */
export function inputVatDeductible(organization: { taxSystem: string; rates: TaxRateRecord[] } | undefined, date: Date): boolean {
  if (!organization) return false;
  const system = isTaxSystem(organization.taxSystem) ? organization.taxSystem : "osn";
  if (system === "osn") return true;
  if (system === "ausn_income" || system === "ausn_income_expense" || system === "psn") return false;
  const rate = rateAt(organization.rates, "vat", date);
  return rate !== null && vatDeductible(rate);
}

export type InputVatRule = (organizationId: string, date: Date) => boolean;

/** Правило вычета входящего НДС по всем организациям — одна загрузка на отчёт. */
export async function loadInputVatRule(): Promise<InputVatRule> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, taxSystem: true, taxRates: { where: { taxKind: "vat" } } },
  });
  const byId = new Map(organizations.map((o) => [o.id, { taxSystem: o.taxSystem, rates: o.taxRates }]));
  return (organizationId, date) => inputVatDeductible(byId.get(organizationId), date);
}
