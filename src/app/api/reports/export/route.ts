import { NextRequest } from "next/server";
import { requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { resolveReportPeriod } from "@/lib/reports/period";
import { extractFilters } from "@/lib/reports/filters";
import { computeCashFlowReport } from "@/lib/reports/cashflow";
import { computePnlReport, derivePnlTotals, PNL_TYPE_LABELS as TYPE_LABELS, PNL_TYPE_ORDER } from "@/lib/reports/pnl";
import { loadPlanItems } from "@/lib/budget/load";
import {
  mergePlanIntoRows,
  planFactMetrics,
  planTotal,
  resolvePlanAvailability,
  type PlanFactMetrics,
  type PlanItem,
} from "@/lib/budget/plan-fact";
import type { ReportFilters } from "@/lib/reports/filters";
import type { AccessScope } from "@/lib/access-scope";
import type { BudgetKind } from "@prisma/client";
import type Decimal from "decimal.js";
import { computeDebtsReport } from "@/lib/reports/debts";
import { computeManagementBalance } from "@/lib/reports/balance";
import { computePayrollSummary, type PayrollSummaryLine } from "@/lib/payroll/summary";
import { projectScenario, type ScenarioValueRow } from "@/lib/financial-model/project";
import { loadNewServices } from "@/lib/financial-model/new-services";
import { loadLoans, loadOpeningBalances } from "@/lib/financial-model/loans";
import { getCurrentCashBalance } from "@/lib/financial-model/current-cash";
import { MONTH_NAMES_SHORT } from "@/lib/financial-model/drivers";
import { buildWorkbookBuffer, type ExportSheet } from "@/lib/reports/xlsx-export";
import { getAccessScope, payrollRunScopeWhere } from "@/lib/access-scope";
import { prisma } from "@/lib/db";
import { toDecimal } from "@/lib/money";

function toNum(d: { toNumber: () => number }) {
  return d.toNumber();
}

const PLAN_HEADERS = ["План", "Отклонение", "Исполнение, %"];

function planCells(m: PlanFactMetrics): Array<string | number> {
  if (!m.plan) return ["", "", ""];
  return [toNum(m.plan), m.deviation ? toNum(m.deviation) : "", m.executionPct ? Number(m.executionPct.toFixed(2)) : ""];
}

/** План для выгрузки — по тем же правилам, что и на экране; пусто, если с этими фильтрами план не сравним. */
async function loadAvailablePlan(
  kind: BudgetKind,
  year: number,
  month: number,
  filters: ReportFilters,
  scope: AccessScope,
): Promise<PlanItem[]> {
  const availability = resolvePlanAvailability(filters, scope);
  return availability.available ? loadPlanItems(kind, year, month, availability.organizationIds) : [];
}

const SCENARIO_HORIZON_MONTHS = 12;

function addMonths(year: number, month: number, offset: number) {
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export async function GET(request: NextRequest) {
  let session;
  try {
    session = await requirePermission(PERMISSIONS.REPORTS_EXPORT);
  } catch {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const scope = await getAccessScope(session);

  const sp = Object.fromEntries(request.nextUrl.searchParams.entries());
  const type = sp.type;
  const filters = extractFilters(sp);

  let sheets: ExportSheet[];
  let fileName: string;

  if (type === "cash-flow") {
    const period = resolveReportPeriod(sp);
    const report = await computeCashFlowReport(period, filters, scope);
    const planItems = await loadAvailablePlan("CASH_FLOW", period.year, period.month, filters, scope);
    const withPlan = planItems.length > 0;
    const header = withPlan ? ["Статья", "Факт", ...PLAN_HEADERS] : ["Статья", "Сумма"];
    const articleRows = (rows: typeof report.inflowRows, group: string) =>
      mergePlanIntoRows(rows, planItems.filter((p) => p.group === group), (item) => ({
        articleId: item.articleId,
        articleName: item.articleName,
        amount: toDecimal(0),
        transactionIds: [],
      })).map((r) => [r.articleName, toNum(r.amount), ...(withPlan ? planCells(r) : [])]);
    const totalRow = (label: string, fact: Decimal, group: string) => [
      label,
      toNum(fact),
      ...(withPlan ? planCells(planFactMetrics(fact, planTotal(planItems, group))) : []),
    ];
    const rows: Array<Array<string | number>> = [
      ["ДДС", period.label],
      [],
      ["Остаток на начало периода", toNum(report.openingBalance)],
      [],
      ["Поступления по статьям"],
      header,
      ...articleRows(report.inflowRows, "INFLOW"),
      totalRow("Итого поступления", report.totalInflow, "INFLOW"),
      [],
      ["Выплаты по статьям"],
      header,
      ...articleRows(report.outflowRows, "OUTFLOW"),
      totalRow("Итого выплаты", report.totalOutflow, "OUTFLOW"),
      [],
      ["Внутренние переводы (нетто)", toNum(report.transfersNet)],
      ["Остаток на конец периода", toNum(report.closingBalance)],
    ];
    sheets = [{ name: "ДДС", rows }];
    fileName = `dds_${period.year}_${period.month}.xlsx`;
  } else if (type === "pnl") {
    const period = resolveReportPeriod(sp);
    const report = await computePnlReport(period, filters, scope);
    const planItems = await loadAvailablePlan("PNL", period.year, period.month, filters, scope);
    const withPlan = planItems.length > 0;
    const plan = (fact: Decimal, planned: Decimal | null) => (withPlan ? planCells(planFactMetrics(fact, planned)) : []);
    const rows: Array<Array<string | number>> = [["ОПиУ", period.label], []];
    if (withPlan) rows.push(["Статья", "Факт", ...PLAN_HEADERS]);
    const planByType = new Map(PNL_TYPE_ORDER.map((t) => [t, planTotal(planItems, t)]));
    for (const t of PNL_TYPE_ORDER) {
      const bucket = report.byType[t];
      const merged = mergePlanIntoRows(bucket.rows, planItems.filter((p) => p.group === t), (item) => ({
        articleId: item.articleId,
        articleName: item.articleName,
        amount: toDecimal(0),
        documentIds: [],
      }));
      rows.push([TYPE_LABELS[t], toNum(bucket.total), ...plan(bucket.total, planByType.get(t) ?? null)]);
      for (const row of merged) {
        rows.push([`  ${row.articleName}`, toNum(row.amount), ...(withPlan ? planCells(row) : [])]);
      }
    }
    const planTotals = derivePnlTotals({
      revenue: planByType.get("REVENUE") ?? toDecimal(0),
      directVariable: planByType.get("DIRECT_VARIABLE") ?? toDecimal(0),
      directFixed: planByType.get("DIRECT_FIXED") ?? toDecimal(0),
      indirect: planByType.get("INDIRECT") ?? toDecimal(0),
      otherIncome: planByType.get("OTHER_INCOME") ?? toDecimal(0),
      otherExpense: planByType.get("OTHER_EXPENSE") ?? toDecimal(0),
      tax: planByType.get("TAX") ?? toDecimal(0),
    });
    rows.push(
      [],
      ["Валовая прибыль", toNum(report.grossProfit), ...plan(report.grossProfit, planTotals.grossProfit)],
      ["Операционная прибыль", toNum(report.operatingProfit), ...plan(report.operatingProfit, planTotals.operatingProfit)],
      ["Чистая прибыль", toNum(report.netProfit), ...plan(report.netProfit, planTotals.netProfit)],
    );
    sheets = [{ name: "ОПиУ", rows }];
    fileName = `opiu_${period.year}_${period.month}.xlsx`;
  } else if (type === "debts") {
    const report = await computeDebtsReport(filters, scope);
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
  } else if (type === "balance") {
    const asOfDate = sp.asOf ? new Date(sp.asOf) : new Date();
    const balance = await computeManagementBalance(asOfDate, filters, scope);
    const rows: Array<Array<string | number>> = [
      ["Управленческий баланс", "на " + balance.asOfDate.toISOString().slice(0, 10)],
      [],
      ["Активы"],
      ["Денежные средства", toNum(balance.cash)],
      ["Дебиторская задолженность", toNum(balance.receivable)],
      ["Авансы выданные", toNum(balance.advancesIssued)],
      ...balance.assetArticles.map((a) => [a.name, toNum(a.amount)]),
      ["Итого активы", toNum(balance.totalAssets)],
      [],
      ["Обязательства и капитал"],
      ["Кредиторская задолженность", toNum(balance.payable)],
      ["Авансы полученные", toNum(balance.advancesReceived)],
      ["Налоги и зарплата к выплате", toNum(balance.payrollPayable)],
      ...balance.liabilityArticles.map((a) => [a.name, toNum(a.amount)]),
      ["Итого обязательства", toNum(balance.totalLiabilities)],
      ...balance.equityArticles.map((a) => [a.name, toNum(a.amount)]),
      ["Нераспределённая прибыль", toNum(balance.retainedEarnings)],
      ["Итого капитал", toNum(balance.totalEquity)],
      [],
      ["Контрольное равенство", balance.isBalanced ? "выполняется" : "расхождение"],
      ["Расхождение", toNum(balance.discrepancy)],
    ];
    sheets = [{ name: "Баланс", rows }];
    fileName = `balance_${asOfDate.toISOString().slice(0, 10)}.xlsx`;
  } else if (type === "payroll-summary") {
    const date = sp.date ? new Date(sp.date) : new Date();
    const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59));
    const runs = await prisma.payrollRun.findMany({
      where: { payoutDate: { gte: from, lte: to }, ...payrollRunScopeWhere(scope) },
      include: {
        organization: true,
        lines: { include: { employee: { include: { department: true } }, department: true, project: true } },
      },
    });
    const lines: PayrollSummaryLine[] = runs.flatMap((r) =>
      r.lines.map((l) => ({
        organizationId: r.organization.id,
        organizationName: r.organization.shortName || r.organization.name,
        departmentId: l.department?.id ?? null,
        departmentName: l.department?.name ?? null,
        projectId: l.project?.id ?? null,
        projectName: l.project?.name ?? null,
        employeeId: l.employeeId,
        employeeName: l.employee.fullName,
        paymentMethod: l.employee.paymentMethod,
        amount: toDecimal(l.amount),
        ndflAmount: toDecimal(l.ndflAmount),
        insuranceAmount: toDecimal(l.insuranceAmount),
      })),
    );
    const summary = computePayrollSummary(lines);
    const rows: Array<Array<string | number>> = [
      ["Сводная ведомость", from.toISOString().slice(0, 10)],
      [],
      ["К выплате наличными", toNum(summary.cashTotal)],
      ["К выплате безналично", toNum(summary.bankTotal)],
      ["НДФЛ", toNum(summary.ndflTotal)],
      ["Страховые взносы", toNum(summary.insuranceTotal)],
      ["Итоговая денежная потребность", toNum(summary.cashNeedTotal)],
      [],
      ["По организациям"],
      ["Название", "К выплате"],
      ...summary.byOrganization.map((r) => [r.name, toNum(r.net)]),
      [],
      ["По подразделениям"],
      ["Название", "К выплате"],
      ...summary.byDepartment.map((r) => [r.name, toNum(r.net)]),
      [],
      ["По сотрудникам"],
      ["ФИО", "Способ выплаты", "К выплате"],
      ...summary.byEmployee.map((r) => [r.name, r.paymentMethod === "CASH" ? "наличные" : "безналичные", toNum(r.net)]),
    ];
    sheets = [{ name: "Сводная ведомость", rows }];
    fileName = `payroll_summary_${from.toISOString().slice(0, 10)}.xlsx`;
  } else if (type === "scenario-forecast") {
    const scenarioId = sp.scenarioId;
    if (!scenarioId) return new Response("Не указан scenarioId", { status: 400 });
    const scenario = await prisma.financialScenario.findUnique({ where: { id: scenarioId }, include: { values: true } });
    if (!scenario) return new Response("Сценарий не найден", { status: 404 });

    const now = new Date();
    const startYear = Number(sp.startYear) || now.getFullYear();
    const startMonth = Number(sp.startMonth) || now.getMonth() + 1;
    const months = Array.from({ length: SCENARIO_HORIZON_MONTHS }, (_, i) => addMonths(startYear, startMonth, i));

    const startingCash = await getCurrentCashBalance(scope);
    const rows_: ScenarioValueRow[] = scenario.values.map((v) => ({
      year: v.year,
      month: v.month,
      driver: v.driver,
      dimension: v.dimension,
      value: v.value.toString(),
    }));
    const newServices = (await loadNewServices([scenarioId])).get(scenarioId) ?? [];
    const loans = (await loadLoans([scenarioId])).get(scenarioId) ?? [];
    const opening = await loadOpeningBalances(scope);
    const projection = projectScenario(startYear, startMonth, SCENARIO_HORIZON_MONTHS, rows_, startingCash, newServices, {
      ...opening,
      loans,
    });
    const revenueRows: Array<Array<string | number>> =
      newServices.length > 0
        ? [
            ["Выручка — база (драйверы)", ...projection.map((p) => toNum(p.baseRevenue))],
            ...newServices.map((service) => [
              `Выручка — ${service.name}`,
              ...projection.map((p) => {
                const month = p.newServices.find((x) => x.id === service.id);
                return month ? toNum(month.revenue) : 0;
              }),
            ]),
            ["Выручка итого", ...projection.map((p) => toNum(p.revenue))],
          ]
        : [["Выручка", ...projection.map((p) => toNum(p.revenue))]];

    const monthHeaders = months.map((m) => `${MONTH_NAMES_SHORT[m.month - 1]} ${m.year}`);
    const rows: Array<Array<string | number>> = [
      ["Прогноз сценария", scenario.name],
      [],
      ["Показатель", ...monthHeaders],
      ...revenueRows,
      ["Переменные расходы", ...projection.map((p) => toNum(p.variableCosts))],
      ["Комиссия посредников", ...projection.map((p) => toNum(p.intermediaryCommission))],
      ["Валовая прибыль", ...projection.map((p) => toNum(p.grossProfit))],
      ["Постоянные расходы", ...projection.map((p) => toNum(p.fixedCosts))],
      ["ФОТ", ...projection.map((p) => toNum(p.payrollCost))],
      ["Требуемая численность", ...projection.map((p) => p.totalHeadcount)],
      ["Операционная прибыль", ...projection.map((p) => toNum(p.operatingProfit))],
      ["Точка безубыточности", ...projection.map((p) => (p.breakEvenRevenue ? toNum(p.breakEvenRevenue) : ""))],
      ["Запас прочности, %", ...projection.map((p) => (p.marginOfSafetyPct ? toNum(p.marginOfSafetyPct) : ""))],
      ["Проценты по кредитам", ...projection.map((p) => toNum(p.loanInterest))],
      ["Прибыль после процентов", ...projection.map((p) => toNum(p.netProfit))],
      [],
      ["Поступления от клиентов", ...projection.map((p) => toNum(p.collections))],
      ["Погашение текущей дебиторки", ...projection.map((p) => toNum(p.openingReceivableCollected))],
      ["Оплаты поставщикам (переменные расходы и комиссия)", ...projection.map((p) => toNum(p.supplierPayments))],
      ["Оплата текущей кредиторки и зарплаты", ...projection.map((p) => toNum(p.openingPayablePaid))],
      ["Постоянные расходы и ФОТ", ...projection.map((p) => toNum(p.fixedCosts.plus(p.payrollCost)))],
      ["Получение кредитов", ...projection.map((p) => toNum(p.loanDrawdown))],
      ["Проценты по кредитам (оплата)", ...projection.map((p) => toNum(p.loanInterest))],
      ["Погашение основного долга", ...projection.map((p) => toNum(p.loanPrincipal))],
      ["Прочие платежи по кредитам/лизингу", ...projection.map((p) => toNum(p.manualLoanPayments))],
      ["Остаток денег", ...projection.map((p) => toNum(p.cashBalance))],
      ["Дебиторка на конец месяца", ...projection.map((p) => toNum(p.receivableEnd))],
      ["Кредиторка на конец месяца", ...projection.map((p) => toNum(p.payableEnd))],
      ["Долг по кредитам на конец месяца", ...projection.map((p) => toNum(p.loanDebt))],
    ];
    sheets = [{ name: "Прогноз", rows }];
    // Content-Disposition filename must be ASCII (HTTP headers are ByteString) — Cyrillic scenario names get transliterated away.
    const safeName = scenario.name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "scenario";
    fileName = `scenario_${safeName}.xlsx`;
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
