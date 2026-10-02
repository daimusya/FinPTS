import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { PeriodStatus, type Prisma } from "@prisma/client";
import { formatMoney, formatNumber, sumMoney } from "@/lib/money";
import { resolveReportPeriod } from "@/lib/reports/period";
import { computePnlReport } from "@/lib/reports/pnl";
import { getSession } from "@/lib/session";
import { dashboardBlocks } from "@/lib/dashboard-blocks";
import { cashBalanceRub } from "@/lib/currency-rates";
import { formatMoneyIn } from "@/lib/currency";
import { isForeign, outstanding } from "@/lib/accruals/currency";
import { amountInRub, loadRateLookup } from "@/lib/currency-rates";
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

/**
 * Дашборд: каждый блок — только при праве на соответствующий раздел (деньги —
 * банк и касса, долги — начисления или отчёты, прибыль — отчёты, справочные
 * количества — справочники, сотрудники — зарплата) и в пределах видимости
 * пользователя. Данные блоков без права не запрашиваются вовсе.
 */
export default async function DashboardPage() {
  const currentPeriod = resolveReportPeriod({});
  const session = await getSession();
  if (!session) redirect("/login");
  const scope = await getAccessScope(session);
  const show = dashboardBlocks(session.permissions);

  const accrualScope = accrualScopeWhere(scope);
  const bankScope = bankTransactionScopeWhere(scope);
  const skip = <T,>(value: T) => Promise.resolve(value);

  const [organizations, departments, counterparties, projects, employees, openPeriods, cash, unpaidDocuments, unmatchedTransactions, upcomingRequests, pnl] =
    await Promise.all([
      show.masterData ? prisma.organization.count({ where: { isArchived: false, ...organizationScopeWhere(scope) } }) : skip(0),
      show.masterData ? prisma.department.count({ where: { isArchived: false, ...departmentScopeWhere(scope) } }) : skip(0),
      show.masterData ? prisma.counterparty.count({ where: { isArchived: false } }) : skip(0),
      show.masterData ? prisma.project.count({ where: { isArchived: false, ...projectScopeWhere(scope) } }) : skip(0),
      show.employees ? prisma.employee.count({ where: employeeScopeWhere(scope) }) : skip(0),
      show.periods ? prisma.accountingPeriod.count({ where: { status: PeriodStatus.OPEN } }) : skip(0),
      show.cash ? cashBalanceRub(bankScope) : skip(null),
      show.debts
        ? prisma.accrualDocument.findMany({
            where: {
              AND: [{ status: "POSTED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, accrualScope],
            } as Prisma.AccrualDocumentWhereInput,
            include: { lines: true, allocations: { where: { cancelledAt: null } } },
          })
        : skip([]),
      show.cash ? prisma.bankTransaction.count({ where: { matchStatus: "UNMATCHED", ...bankScope } }) : skip(0),
      show.requests
        ? prisma.paymentRequest.findMany({
            where: { status: "APPROVED", ...paymentRequestScopeWhere(scope) },
            include: { organization: true, parts: { where: { paidAt: { not: null } }, select: { amount: true } } },
          })
        : skip([]),
      show.pnl ? computePnlReport(currentPeriod, {}, scope) : skip(null),
    ]);

  const foreignCash = cash ? [...cash.byCurrency.entries()].filter(([currency, amount]) => currency !== "RUB" && !amount.isZero()) : [];

  const now = new Date();
  let receivable = sumMoney([]);
  let payable = sumMoney([]);
  let overdueTotal = sumMoney([]);
  const rates = await loadRateLookup();
  for (const doc of unpaidDocuments) {
    // A document in a foreign currency counts at today's rate.
    const left = outstanding(doc, isForeign(doc.currency) ? rates.rateOn(doc.currency, now) : null);
    const remaining = left.rub;
    if (left.native.lessThanOrEqualTo(0)) continue;
    if (doc.direction === "INCOME") receivable = receivable.plus(remaining);
    else payable = payable.plus(remaining);
    if (doc.dueDate && doc.dueDate < now) overdueTotal = overdueTotal.plus(remaining);
  }

  // Requests paid in parts count only what is still to be paid.
  const upcomingPaymentsTotal = sumMoney(
    upcomingRequests.map((r) => {
      const left = sumMoney([r.amount]).minus(sumMoney(r.parts.map((p) => p.amount)));
      return amountInRub(left, r.currency, rates) ?? left;
    }),
  );

  const reportLinks = [
    { href: "/reports/cash-flow", label: "ДДС", allowed: show.pnl },
    { href: "/reports/pnl", label: "ОПиУ", allowed: show.pnl },
    { href: "/reports/balance", label: "Управленческий баланс", allowed: show.pnl },
    { href: "/reports/margin", label: "Маржинальность и ТБУ", allowed: show.pnl },
    { href: "/payment-calendar", label: "Платёжный календарь", allowed: show.cash },
    { href: "/reports/debts", label: "Дебиторка и кредиторка", allowed: show.pnl },
  ].filter((l) => l.allowed);
  const nothing = !Object.values(show).some(Boolean);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Дашборд</h1>
          <p>Показатели читаются напрямую из базы данных — по разделам, на которые у вас есть права.</p>
        </div>
      </div>

      {nothing ? (
        <div className="card">
          <p className="text-muted">
            Для вашей роли показателей на дашборде нет. Разделы, доступные вам, — в меню слева; расширить права может администратор.
          </p>
        </div>
      ) : null}

      {show.cash || show.debts || show.requests ? (
        <div className="stat-grid">
          {show.cash && cash ? (
            <StatCard
              label="Остаток денег (все счета и кассы)"
              value={formatMoney(cash.total)}
              note={
                foreignCash.length > 0
                  ? `в т. ч. ${foreignCash.map(([currency, amount]) => formatMoneyIn(amount, currency)).join(", ")} по курсу ЦБ${cash.missingRates ? ` (нет курса: ${cash.missingRates})` : ""}`
                  : undefined
              }
            />
          ) : null}
          {show.debts ? (
            <>
              <StatCard label="Дебиторская задолженность" value={formatMoney(receivable)} />
              <StatCard label="Кредиторская задолженность" value={formatMoney(payable)} />
              <StatCard label="Просроченная задолженность" value={formatMoney(overdueTotal)} danger={overdueTotal.greaterThan(0)} />
            </>
          ) : null}
          {show.cash ? (
            <StatCard label="Несопоставленные банковские операции" value={String(unmatchedTransactions)} danger={unmatchedTransactions > 0} />
          ) : null}
          {show.requests ? <StatCard label="Согласованные заявки к оплате" value={formatMoney(upcomingPaymentsTotal)} /> : null}
        </div>
      ) : null}

      {show.masterData || show.employees || show.periods ? (
        <div className="stat-grid">
          {show.masterData ? (
            <>
              <StatCard label="Организации и ИП" value={String(organizations)} />
              <StatCard label="Подразделения" value={String(departments)} />
              <StatCard label="Контрагенты" value={String(counterparties)} />
              <StatCard label="Проекты" value={String(projects)} />
            </>
          ) : null}
          {show.employees ? <StatCard label="Сотрудники" value={String(employees)} /> : null}
          {show.periods ? <StatCard label="Открытые периоды" value={String(openPeriods)} /> : null}
        </div>
      ) : null}

      {show.pnl && pnl ? (
        <div className="stat-grid">
          <StatCard label={`Выручка (${currentPeriod.label})`} value={formatMoney(pnl.revenue)} />
          <StatCard label="Валовая прибыль" value={formatMoney(pnl.grossProfit)} />
          <StatCard label="Операционная прибыль" value={formatMoney(pnl.operatingProfit)} />
          <StatCard label="Чистая прибыль" value={formatMoney(pnl.netProfit)} danger={pnl.netProfit.isNegative()} />
          <StatCard label="Валовая рентабельность" value={pnl.grossMarginPct ? `${formatNumber(pnl.grossMarginPct)}%` : "—"} />
          <StatCard label="Чистая рентабельность" value={pnl.netMarginPct ? `${formatNumber(pnl.netMarginPct)}%` : "—"} />
        </div>
      ) : null}

      {reportLinks.length > 0 ? (
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Управленческая отчётность</h2>
          <p className="text-muted">
            ДДС, ОПиУ, управленческий баланс, маржинальность и точка безубыточности считаются из проведённых документов начисления и
            банковских операций — расшифровка до документа доступна в каждом отчёте.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            {reportLinks.map((l) => (
              <Link key={l.href} href={l.href} className="btn btn-secondary btn-sm">
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, danger, note }: { label: string; value: string; danger?: boolean; note?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: danger ? "var(--color-danger)" : undefined, fontSize: 20 }}>
        {value}
      </div>
      {note ? (
        <div className="text-muted" style={{ fontSize: 12 }}>
          {note}
        </div>
      ) : null}
    </div>
  );
}
