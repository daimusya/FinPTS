import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import type Decimal from "decimal.js";
import type { Prisma } from "@prisma/client";
import type { ReportFilters } from "./filters";
import type { ReportPeriod } from "./period";

function buildWhere(filters: ReportFilters): Prisma.BankTransactionWhereInput {
  const where: Prisma.BankTransactionWhereInput = {};
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.costCenterId) where.costCenterId = filters.costCenterId;
  if (filters.projectId) where.projectId = filters.projectId;
  if (filters.productServiceId) where.productServiceId = filters.productServiceId;
  if (filters.counterpartyId) where.counterpartyId = filters.counterpartyId;
  if (filters.organizationId) {
    where.OR = [
      { bankAccount: { organizationId: filters.organizationId } },
      { cashAccount: { organizationId: filters.organizationId } },
    ];
  }
  return where;
}

export interface CashFlowArticleRow {
  articleId: string | null;
  articleName: string;
  amount: Decimal;
  transactionIds: string[];
}

export interface CashFlowReport {
  openingBalance: Decimal;
  inflowRows: CashFlowArticleRow[];
  outflowRows: CashFlowArticleRow[];
  totalInflow: Decimal;
  totalOutflow: Decimal;
  transfersNet: Decimal;
  netFlow: Decimal;
  closingBalance: Decimal;
}

function groupByArticle(
  transactions: Array<{ id: string; amount: Prisma.Decimal; cashFlowArticleId: string | null; cashFlowArticle: { name: string } | null }>,
): CashFlowArticleRow[] {
  const map = new Map<string, CashFlowArticleRow>();
  for (const tx of transactions) {
    const key = tx.cashFlowArticleId ?? "__none__";
    const row = map.get(key) ?? {
      articleId: tx.cashFlowArticleId,
      articleName: tx.cashFlowArticle?.name ?? "Без статьи",
      amount: toDecimal(0),
      transactionIds: [],
    };
    row.amount = row.amount.plus(toDecimal(tx.amount));
    row.transactionIds.push(tx.id);
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.amount.comparedTo(a.amount));
}

export async function computeCashFlowReport(period: ReportPeriod, filters: ReportFilters): Promise<CashFlowReport> {
  const where = buildWhere(filters);

  const [openingTx, periodTx] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { ...where, operationDate: { lt: period.from } },
      select: { amount: true, direction: true },
    }),
    prisma.bankTransaction.findMany({
      where: { ...where, operationDate: { gte: period.from, lte: period.to } },
      include: { cashFlowArticle: true },
    }),
  ]);

  const openingInflow = sumMoney(openingTx.filter((t) => t.direction === "INFLOW").map((t) => t.amount));
  const openingOutflow = sumMoney(openingTx.filter((t) => t.direction === "OUTFLOW").map((t) => t.amount));
  const openingBalance = openingInflow.minus(openingOutflow);

  const transfers = periodTx.filter((t) => t.isTransfer);
  const operating = periodTx.filter((t) => !t.isTransfer);

  const inflowRows = groupByArticle(operating.filter((t) => t.direction === "INFLOW"));
  const outflowRows = groupByArticle(operating.filter((t) => t.direction === "OUTFLOW"));

  const totalInflow = sumMoney(inflowRows.map((r) => r.amount));
  const totalOutflow = sumMoney(outflowRows.map((r) => r.amount));

  const transfersInflow = sumMoney(transfers.filter((t) => t.direction === "INFLOW").map((t) => t.amount));
  const transfersOutflow = sumMoney(transfers.filter((t) => t.direction === "OUTFLOW").map((t) => t.amount));
  const transfersNet = transfersInflow.minus(transfersOutflow);

  const netFlow = totalInflow.minus(totalOutflow).plus(transfersNet);
  const closingBalance = openingBalance.plus(netFlow);

  return { openingBalance, inflowRows, outflowRows, totalInflow, totalOutflow, transfersNet, netFlow, closingBalance };
}
