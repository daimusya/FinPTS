import { monthRange, type ReportPeriod } from "@/lib/reports/period";
import { computeCashFlowReport } from "@/lib/reports/cashflow";
import { computePnlReport } from "@/lib/reports/pnl";
import { computeManagementBalance } from "@/lib/reports/balance";

export interface ClosingSnapshot {
  computedAt: string;
  cashOpening: string;
  cashClosing: string;
  revenue: string;
  netProfit: string;
  receivable: string;
  payable: string;
  totalAssets: string;
  totalLiabilities: string;
  balanceDiscrepancy: string;
}

/**
 * Контрольные остатки и итоговые показатели, зафиксированные на момент
 * закрытия периода (раздел 17 ТЗ). Снимок сохраняется в
 * AccountingPeriod.closingSnapshot и не пересчитывается задним числом —
 * так же, как остаются неизменными закрытые документы.
 */
export async function computeClosingSnapshot(year: number, month: number): Promise<ClosingSnapshot> {
  const period: ReportPeriod = { ...monthRange(year, month), year, month, label: `${month}.${year}` };
  const { to } = monthRange(year, month);

  const [cashFlow, pnl, balance] = await Promise.all([
    computeCashFlowReport(period, {}),
    computePnlReport(period, {}),
    computeManagementBalance(to, {}),
  ]);

  return {
    computedAt: new Date().toISOString(),
    cashOpening: cashFlow.openingBalance.toFixed(2),
    cashClosing: cashFlow.closingBalance.toFixed(2),
    revenue: pnl.revenue.toFixed(2),
    netProfit: pnl.netProfit.toFixed(2),
    receivable: balance.receivable.toFixed(2),
    payable: balance.payable.toFixed(2),
    totalAssets: balance.totalAssets.toFixed(2),
    totalLiabilities: balance.totalLiabilities.toFixed(2),
    balanceDiscrepancy: balance.discrepancy.toFixed(2),
  };
}
