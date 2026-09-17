import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { resolveReportPeriod } from "@/lib/reports/period";
import { extractFilters } from "@/lib/reports/filters";
import { computeCashFlowReport } from "@/lib/reports/cashflow";
import { computePnlReport, PNL_TYPE_ORDER } from "@/lib/reports/pnl";
import { computeDebtsReport } from "@/lib/reports/debts";
import { buildWorkbookBuffer, type ExportSheet } from "@/lib/reports/xlsx-export";

const TYPE_LABELS: Record<string, string> = {
  REVENUE: "Выручка",
  DIRECT_VARIABLE: "Прямые переменные расходы",
  DIRECT_FIXED: "Прямые постоянные расходы",
  INDIRECT: "Косвенные расходы",
  OTHER_INCOME: "Прочие доходы",
  OTHER_EXPENSE: "Прочие расходы",
  TAX: "Налоги",
};

function toNum(d: { toNumber: () => number }) {
  return d.toNumber();
}

export async function GET(request: NextRequest) {
  try {
    await requirePermission(PERMISSIONS.REPORTS_EXPORT);
  } catch {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const type = sp.type;
  const filters = extractFilters(sp);

  let sheets: ExportSheet[];
  let fileName: string;

  if (type === "cash-flow") {
    const period = resolveReportPeriod(sp);
    const report = await computeCashFlowReport(period, filters);
    const rows: Array<Array<string | number>> = [
      ["ДДС", period.label],
      [],
      ["Остаток на начало периода", toNum(report.openingBalance)],
      [],
      ["Поступления по статьям"],
      ["Статья", "Сумма"],
      ...report.inflowRows.map((r) => [r.articleName, toNum(r.amount)]),
      ["Итого поступления", toNum(report.totalInflow)],
      [],
      ["Выплаты по статьям"],
      ["Статья", "Сумма"],
      ...report.outflowRows.map((r) => [r.articleName, toNum(r.amount)]),
      ["Итого выплаты", toNum(report.totalOutflow)],
      [],
      ["Внутренние переводы (нетто)", toNum(report.transfersNet)],
      ["Остаток на конец периода", toNum(report.closingBalance)],
    ];
    sheets = [{ name: "ДДС", rows }];
    fileName = `dds_${period.year}_${period.month}.xlsx`;
  } else if (type === "pnl") {
    const period = resolveReportPeriod(sp);
    const report = await computePnlReport(period, filters);
    const rows: Array<Array<string | number>> = [["ОПиУ", period.label], []];
    for (const t of PNL_TYPE_ORDER) {
      const bucket = report.byType[t];
      rows.push([TYPE_LABELS[t], toNum(bucket.total)]);
      for (const row of bucket.rows) {
        rows.push([`  ${row.articleName}`, toNum(row.amount)]);
      }
    }
    rows.push(
      [],
      ["Валовая прибыль", toNum(report.grossProfit)],
      ["Операционная прибыль", toNum(report.operatingProfit)],
      ["Чистая прибыль", toNum(report.netProfit)],
    );
    sheets = [{ name: "ОПиУ", rows }];
    fileName = `opiu_${period.year}_${period.month}.xlsx`;
  } else if (type === "debts") {
    const report = await computeDebtsReport(filters);
    const receivableRows: Array<Array<string | number>> = [
      ["Контрагент", "Документ", "Срок оплаты", "Остаток", "Просрочено"],
      ...report.receivableRows.flatMap((row) =>
        row.documents.map((d) => [
          row.counterpartyName,
          d.number,
          d.dueDate ? d.dueDate.toISOString().slice(0, 10) : "",
          toNum(d.remaining),
          d.overdue ? "да" : "нет",
        ]),
      ),
    ];
    const payableRows: Array<Array<string | number>> = [
      ["Контрагент", "Документ", "Срок оплаты", "Остаток", "Просрочено"],
      ...report.payableRows.flatMap((row) =>
        row.documents.map((d) => [
          row.counterpartyName,
          d.number,
          d.dueDate ? d.dueDate.toISOString().slice(0, 10) : "",
          toNum(d.remaining),
          d.overdue ? "да" : "нет",
        ]),
      ),
    ];
    sheets = [
      { name: "Дебиторская задолженность", rows: receivableRows },
      { name: "Кредиторская задолженность", rows: payableRows },
    ];
    fileName = "debts.xlsx";
  } else {
    return new Response("Неизвестный тип отчёта", { status: 400 });
  }

  const buffer = buildWorkbookBuffer(sheets);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
