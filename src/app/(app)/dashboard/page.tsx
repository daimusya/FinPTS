import Link from "next/link";
import { prisma } from "@/lib/db";
import { PeriodStatus, type Prisma } from "@prisma/client";
import { formatMoney, formatNumber, sumMoney } from "@/lib/money";
import { resolveReportPeriod } from "@/lib/reports/period";
import { computePnlReport } from "@/lib/reports/pnl";
import { getSession } from "@/lib/session";
import {
  accrualScopeWhere,
  bankTransactionScopeWhere,
  departmentScopeWhere,
  employeeScopeWhere,
  getAccessScope,
  organizationScopeWhere,
  paymentRequestScopeWhere,
  projectScopeWhere,
} from "@/lib/access-scope";

export default async function DashboardPage() {
  const currentPeriod = resolveReportPeriod({});
  const session = await getSession();
  const scope = session ? await getAccessScope(session) : { organizationIds: [], departmentIds: [], projectIds: [] };

  const accrualScope = accrualScopeWhere(scope);
  const bankScope = bankTransactionScopeWhere(scope);

  const [
    organizations,
    departments,
    counterparties,
    projects,
    employees,
    openPeriods,
    bankTransactions,
    unpaidDocuments,
    unmatchedTransactions,
    upcomingRequests,
    pnl,
  ] = await Promise.all([
    prisma.organization.count({ where: { isArchived: false, ...organizationScopeWhere(scope) } }),
    prisma.department.count({ where: { isArchived: false, ...departmentScopeWhere(scope) } }),
    prisma.counterparty.count({ where: { isArchived: false } }),
    prisma.project.count({ where: { isArchived: false, ...projectScopeWhere(scope) } }),
    prisma.employee.count({ where: employeeScopeWhere(scope) }),
    prisma.accountingPeriod.count({ where: { status: PeriodStatus.OPEN } }),
    prisma.bankTransaction.findMany({ where: bankScope, select: { amount: true, direction: true } }),
    prisma.accrualDocument.findMany({
      where: {
        AND: [{ status: "POSTED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, accrualScope],
      } as Prisma.AccrualDocumentWhereInput,
      include: { lines: true, allocations: { where: { cancelledAt: null } } },
    }),
    prisma.bankTransaction.count({ where: { matchStatus: "UNMATCHED", ...bankScope } }),
    prisma.paymentRequest.findMany({
      where: { status: "APPROVED", ...paymentRequestScopeWhere(scope) },
      include: { organization: true },
    }),
    computePnlReport(currentPeriod, {}, scope),
  ]);

  const cashInflow = sumMoney(bankTransactions.filter((t) => t.direction === "INFLOW").map((t) => t.amount));
  const cashOutflow = sumMoney(bankTransactions.filter((t) => t.direction === "OUTFLOW").map((t) => t.amount));
  const cashBalance = cashInflow.minus(cashOutflow);

  const now = new Date();
  let receivable = sumMoney([]);
  let payable = sumMoney([]);
  let overdueTotal = sumMoney([]);
  for (const doc of unpaidDocuments) {
    const total = sumMoney(doc.lines.map((l) => l.amount));
    const allocated = sumMoney(doc.allocations.map((a) => a.amount));
    const remaining = total.minus(allocated);
    if (remaining.lessThanOrEqualTo(0)) continue;
    if (doc.direction === "INCOME") receivable = receivable.plus(remaining);
    else payable = payable.plus(remaining);
    if (doc.dueDate && doc.dueDate < now) overdueTotal = overdueTotal.plus(remaining);
  }

  const upcomingPaymentsTotal = sumMoney(upcomingRequests.map((r) => r.amount));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Дашборд</h1>
          <p>Показатели читаются напрямую из базы данных.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Остаток денег (все счета и кассы)" value={formatMoney(cashBalance)} />
        <StatCard label="Дебиторская задолженность" value={formatMoney(receivable)} />
        <StatCard label="Кредиторская задолженность" value={formatMoney(payable)} />
        <StatCard label="Просроченная задолженность" value={formatMoney(overdueTotal)} danger={overdueTotal.greaterThan(0)} />
        <StatCard label="Несопоставленные банковские операции" value={String(unmatchedTransactions)} danger={unmatchedTransactions > 0} />
        <StatCard label="Согласованные заявки к оплате" value={formatMoney(upcomingPaymentsTotal)} />
      </div>

      <div className="stat-grid">
        <StatCard label="Организации и ИП" value={String(organizations)} />
        <StatCard label="Подразделения" value={String(departments)} />
        <StatCard label="Контрагенты" value={String(counterparties)} />
        <StatCard label="Проекты" value={String(projects)} />
        <StatCard label="Сотрудники" value={String(employees)} />
        <StatCard label="Открытые периоды" value={String(openPeriods)} />
      </div>

      <div className="stat-grid">
        <StatCard label={`Выручка (${currentPeriod.label})`} value={formatMoney(pnl.revenue)} />
        <StatCard label="Валовая прибыль" value={formatMoney(pnl.grossProfit)} />
        <StatCard label="Операционная прибыль" value={formatMoney(pnl.operatingProfit)} />
        <StatCard label="Чистая прибыль" value={formatMoney(pnl.netProfit)} danger={pnl.netProfit.isNegative()} />
        <StatCard label="Валовая рентабельность" value={pnl.grossMarginPct ? `${formatNumber(pnl.grossMarginPct)}%` : "—"} />
        <StatCard label="Чистая рентабельность" value={pnl.netMarginPct ? `${formatNumber(pnl.netMarginPct)}%` : "—"} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Управленческая отчётность</h2>
        <p className="text-muted">
          ДДС, ОПиУ, управленческий баланс, маржинальность и точка безубыточности считаются из
          проведённых документов начисления и банковских операций — расшифровка до документа
          доступна в каждом отчёте.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Link href="/reports/cash-flow" className="btn btn-secondary btn-sm">
            ДДС
          </Link>
          <Link href="/reports/pnl" className="btn btn-secondary btn-sm">
            ОПиУ
          </Link>
          <Link href="/reports/balance" className="btn btn-secondary btn-sm">
            Управленческий баланс
          </Link>
          <Link href="/reports/margin" className="btn btn-secondary btn-sm">
            Маржинальность и ТБУ
          </Link>
          <Link href="/payment-calendar" className="btn btn-secondary btn-sm">
            Платёжный календарь
          </Link>
          <Link href="/reports/debts" className="btn btn-secondary btn-sm">
            Дебиторка и кредиторка
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: danger ? "var(--color-danger)" : undefined, fontSize: 20 }}>
        {value}
      </div>
    </div>
  );
}
