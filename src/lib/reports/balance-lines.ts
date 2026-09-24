import Decimal from "decimal.js";
import { sumMoney, toDecimal } from "@/lib/money";

export type BalanceCategory = "ASSET" | "LIABILITY" | "EQUITY";

/**
 * Строки баланса, которые считаются из операций. По ним нельзя вводить
 * балансовые операции и привязывать статьи ДДС — суммы задвоились бы.
 * Нераспределённая прибыль (retained_earnings) сюда не входит: она
 * считается по ОПиУ, но допускает ввод остатка на начало учёта.
 */
export const DERIVED_SYSTEM_CODES: ReadonlySet<string> = new Set([
  "cash",
  "receivable",
  "advances_issued",
  "payable",
  "advances_received",
  "payroll_payable",
]);

export function acceptsManualEntries(systemCode: string | null): boolean {
  return !systemCode || !DERIVED_SYSTEM_CODES.has(systemCode);
}

/**
 * Как движение денег по статье ДДС, привязанной к статье баланса, меняет
 * её остаток: за актив деньги платят (выплата увеличивает актив, поступление
 * от его продажи — уменьшает); обязательство и капитал деньги приносят
 * (поступление займа или взноса увеличивает, возврат — уменьшает).
 */
export function linkedFlowEffect(category: BalanceCategory, direction: "INFLOW" | "OUTFLOW", amount: Decimal): Decimal {
  const increases = category === "ASSET" ? direction === "OUTFLOW" : direction === "INFLOW";
  return increases ? amount : amount.negated();
}

/**
 * Аванс по операции: часть платежа контрагенту, не сопоставленная с
 * документами начисления. Поступление — аванс полученный (обязательство),
 * выплата — аванс выданный (актив). Не авансы: переводы между своими
 * счетами, операции без контрагента и операции по статьям ДДС, привязанным
 * к статье баланса (займы, взносы и т.п. учитываются там).
 */
export function advanceFromTransaction(tx: {
  direction: "INFLOW" | "OUTFLOW";
  amount: Decimal;
  allocated: Decimal;
  hasCounterparty: boolean;
  isTransfer: boolean;
  linkedToBalance: boolean;
}): { issued: Decimal; received: Decimal } {
  const zero = toDecimal(0);
  if (tx.isTransfer || !tx.hasCounterparty || tx.linkedToBalance) return { issued: zero, received: zero };
  const unallocated = Decimal.max(tx.amount.minus(tx.allocated), 0);
  return tx.direction === "INFLOW" ? { issued: zero, received: unallocated } : { issued: unallocated, received: zero };
}

export interface BalanceArticleInput {
  id: string;
  name: string;
  category: BalanceCategory;
  systemCode: string | null;
  /** Сумма балансовых операций на дату. */
  entries: Decimal;
  /** Изменение от операций по привязанным статьям ДДС на дату. */
  linkedFlows: Decimal;
}

export interface BalanceArticleLine {
  id: string;
  name: string;
  entries: Decimal;
  linkedFlows: Decimal;
  amount: Decimal;
}

export interface AssembledBalance {
  cash: Decimal;
  receivable: Decimal;
  advancesIssued: Decimal;
  assetArticles: BalanceArticleLine[];
  totalAssets: Decimal;
  payable: Decimal;
  advancesReceived: Decimal;
  payrollPayable: Decimal;
  liabilityArticles: BalanceArticleLine[];
  totalLiabilities: Decimal;
  equityArticles: BalanceArticleLine[];
  retainedFromPnl: Decimal;
  /** Остаток нераспределённой прибыли на начало учёта и дивиденды — балансовые операции по этой статье. */
  retainedAdjustments: Decimal;
  retainedEarnings: Decimal;
  totalEquity: Decimal;
  equityImpliedByBalance: Decimal;
  discrepancy: Decimal;
  isBalanced: boolean;
}

/**
 * Собирает баланс и проверяет контрольное равенство: Активы − Обязательства
 * = Капитал. Расхождение — диагностика: движения денег или задолженности,
 * которые не прошли ни через документы начисления, ни через статьи баланса
 * (например, расход без документа и без контрагента).
 */
export function assembleBalance(input: {
  cash: Decimal;
  receivable: Decimal;
  payable: Decimal;
  payrollPayable: Decimal;
  advancesIssued: Decimal;
  advancesReceived: Decimal;
  netProfitFromPnl: Decimal;
  articles: BalanceArticleInput[];
}): AssembledBalance {
  const line = (a: BalanceArticleInput): BalanceArticleLine => ({
    id: a.id,
    name: a.name,
    entries: a.entries,
    linkedFlows: a.linkedFlows,
    amount: a.entries.plus(a.linkedFlows),
  });
  const manual = input.articles.filter((a) => !a.systemCode);
  const assetArticles = manual.filter((a) => a.category === "ASSET").map(line);
  const liabilityArticles = manual.filter((a) => a.category === "LIABILITY").map(line);
  const equityArticles = manual.filter((a) => a.category === "EQUITY").map(line);
  const retained = input.articles.find((a) => a.systemCode === "retained_earnings");
  const retainedAdjustments = retained ? retained.entries.plus(retained.linkedFlows) : toDecimal(0);

  const totalAssets = sumMoney([input.cash, input.receivable, input.advancesIssued, ...assetArticles.map((a) => a.amount)]);
  const totalLiabilities = sumMoney([
    input.payable,
    input.advancesReceived,
    input.payrollPayable,
    ...liabilityArticles.map((a) => a.amount),
  ]);
  const retainedEarnings = input.netProfitFromPnl.plus(retainedAdjustments);
  const totalEquity = sumMoney([...equityArticles.map((a) => a.amount), retainedEarnings]);
  const equityImpliedByBalance = totalAssets.minus(totalLiabilities);
  const discrepancy = equityImpliedByBalance.minus(totalEquity);

  return {
    cash: input.cash,
    receivable: input.receivable,
    advancesIssued: input.advancesIssued,
    assetArticles,
    totalAssets,
    payable: input.payable,
    advancesReceived: input.advancesReceived,
    payrollPayable: input.payrollPayable,
    liabilityArticles,
    totalLiabilities,
    equityArticles,
    retainedFromPnl: input.netProfitFromPnl,
    retainedAdjustments,
    retainedEarnings,
    totalEquity,
    equityImpliedByBalance,
    discrepancy,
    isBalanced: discrepancy.abs().lessThan(0.01),
  };
}
