import Link from "next/link";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import {
  adjacentMonths,
  buildCalendarRows,
  buildMonthGrid,
  HIDDEN_REQUEST_STATUSES,
  localDateKey,
  requestPlacement,
  type CalendarMovement,
} from "@/lib/payment-calendar";
import { formatMoney, sumMoney } from "@/lib/money";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payment-requests/labels";
import { PaymentCalendarBoard, type BoardDay, type BoardRequest } from "@/components/payment-calendar-board";

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const WEEKDAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const short = (value: Decimal) => compact.format(value.toNumber());

export default async function PaymentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; pending?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра платёжного календаря.</div>
      </div>
    );
  }
  const canMove =
    hasPermission(session, PERMISSIONS.ADMIN_FULL) ||
    hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE) ||
    hasPermission(session, PERMISSIONS.CASH_MANAGE);

  const params = await searchParams;
  const todayKey = localDateKey();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : todayKey.slice(0, 7);
  const includePending = params.pending !== "0";
  const { prev, next } = adjacentMonths(month);
  const [year, monthNumber] = month.split("-").map(Number);

  const [flows, unpaidDocuments, requests, calendarDays] = await Promise.all([
    prisma.bankTransaction.groupBy({ by: ["direction"], _sum: { amount: true } }),
    prisma.accrualDocument.findMany({
      where: { status: "POSTED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      include: { lines: true, allocations: { where: { cancelledAt: null } } },
    }),
    prisma.paymentRequest.findMany({
      where: { status: { notIn: [...HIDDEN_REQUEST_STATUSES] } },
      include: { organization: true, counterparty: true, cashFlowArticle: true },
      orderBy: [{ dueDate: "asc" }, { amount: "desc" }],
    }),
    prisma.productionCalendarDay.findMany({
      where: { isArchived: false, date: { gte: new Date(Date.UTC(year, monthNumber - 2, 20)), lte: new Date(Date.UTC(year, monthNumber, 10)) } },
    }),
  ]);

  const sumOf = (direction: string) => new Decimal(flows.find((f) => f.direction === direction)?._sum.amount?.toString() ?? 0);
  const currentBalance = sumOf("INFLOW").minus(sumOf("OUTFLOW"));

  const movements: CalendarMovement[] = [];
  for (const doc of unpaidDocuments) {
    const remaining = sumMoney(doc.lines.map((l) => l.amount)).minus(sumMoney(doc.allocations.map((a) => a.amount)));
    if (remaining.lessThanOrEqualTo(0)) continue;
    movements.push({
      date: doc.dueDate ?? doc.date,
      amount: remaining.toString(),
      direction: doc.direction === "INCOME" ? "INFLOW" : "OUTFLOW",
      source: "document",
    });
  }
  const pendingRequests = requests.filter((r) => r.status === "PENDING_APPROVAL" || r.status === "DRAFT");
  for (const req of requests) {
    if (requestPlacement(req.status, includePending).counted) {
      movements.push({ date: req.dueDate, amount: req.amount.toString(), direction: "OUTFLOW", source: "request" });
    }
  }

  const calendar = new Map(
    calendarDays.map((d) => [
      d.date.toISOString().slice(0, 10),
      { kind: d.kind === "workday" ? ("workday" as const) : ("holiday" as const), name: d.name },
    ]),
  );
  const weeks = buildMonthGrid({ month, todayKey, startingBalance: currentBalance, movements, calendar });
  const boardWeeks: BoardDay[][] = weeks.map((week) =>
    week.map((d) => ({
      date: d.date,
      day: d.day,
      weekday: WEEKDAY_NAMES[new Date(`${d.date}T00:00:00Z`).getUTCDay()],
      inMonth: d.inMonth,
      isToday: d.isToday,
      isPast: d.isPast,
      isWorking: d.isWorking,
      holidayName: d.holidayName,
      inflow: d.inflow.greaterThan(0) ? short(d.inflow) : null,
      outflow: d.outflow.greaterThan(0) ? short(d.outflow) : null,
      balance: d.balance ? short(d.balance) : null,
      balanceFull: d.balance ? formatMoney(d.balance) : null,
      balanceNegative: Boolean(d.balance?.lessThan(0)),
    })),
  );

  const gridFirst = weeks[0][0].date;
  const gridLast = weeks[weeks.length - 1][6].date;
  const boardRequests: BoardRequest[] = requests
    .map((r) => {
      const placement = requestPlacement(r.status, includePending);
      const dueKey = r.dueDate.toISOString().slice(0, 10);
      return {
        id: r.id,
        dueDate: dueKey,
        amount: short(new Decimal(r.amount.toString())),
        amountFull: formatMoney(r.amount),
        counterparty: r.counterparty ? r.counterparty.shortName || r.counterparty.fullName : "Без контрагента",
        organization: r.organization.shortName || r.organization.name,
        article: r.cashFlowArticle?.name ?? null,
        status: r.status,
        statusLabel: PAYMENT_REQUEST_STATUS_LABELS[r.status],
        counted: placement.counted,
        movable: placement.movable,
        overdue: placement.movable && dueKey < todayKey,
      };
    })
    // Overdue unpaid requests are always shown (in their own strip); the rest only within the visible weeks.
    .filter((r) => r.overdue || (r.dueDate >= gridFirst && r.dueDate <= gridLast));

  // Future days only: overdue items fall on today, as in the grid.
  const rows = buildCalendarRows(
    currentBalance.toString(),
    movements.map((m) => (m.date.toISOString().slice(0, 10) < todayKey ? { ...m, date: new Date(`${todayKey}T00:00:00Z`) } : m)),
  );
  const monthDays = weeks.flat().filter((d) => d.inMonth && d.balance);
  const lowest = monthDays.reduce<(typeof monthDays)[number] | null>((low, d) => (!low || d.balance!.lessThan(low.balance!) ? d : low), null);
  const expectedIn = sumMoney(movements.filter((m) => m.direction === "INFLOW").map((m) => m.amount));
  const expectedOut = sumMoney(movements.filter((m) => m.direction === "OUTFLOW").map((m) => m.amount));
  const toggleHref = (pending: boolean) => `/payment-calendar?month=${month}${pending ? "" : "&pending=0"}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Платёжный календарь</h1>
          <p>
            Прогноз остатка от текущего фактического остатка по всем счетам и кассам: непогашенные начисления по сроку
            оплаты и заявки на оплату. {canMove ? "Заявку можно перетащить на другой день — срок оплаты перенесётся." : ""}
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Текущий остаток (все счета и кассы)</div>
          <div className="stat-value">{formatMoney(currentBalance)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ожидаемые поступления</div>
          <div className="stat-value">{formatMoney(expectedIn)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ожидаемые платежи</div>
          <div className="stat-value">{formatMoney(expectedOut)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Минимальный остаток в месяце</div>
          <div className="stat-value" style={{ color: lowest?.balance?.lessThan(0) ? "var(--color-danger)" : undefined }}>
            {lowest ? formatMoney(lowest.balance!) : "—"}
          </div>
          {lowest ? <div className="text-muted" style={{ fontSize: 12 }}>{new Date(`${lowest.date}T00:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" })}</div> : null}
        </div>
      </div>

      <div className="pc-toolbar">
        <div className="pc-toolbar__nav">
          <Link href={`/payment-calendar?month=${prev}${includePending ? "" : "&pending=0"}`} className="btn btn-secondary btn-sm" aria-label="Предыдущий месяц">
            ←
          </Link>
          <strong className="pc-toolbar__month">
            {MONTH_NAMES[monthNumber - 1]} {year}
          </strong>
          <Link href={`/payment-calendar?month=${next}${includePending ? "" : "&pending=0"}`} className="btn btn-secondary btn-sm" aria-label="Следующий месяц">
            →
          </Link>
          {month !== todayKey.slice(0, 7) ? (
            <Link href={`/payment-calendar${includePending ? "" : "?pending=0"}`} className="btn btn-ghost btn-sm">
              Сегодня
            </Link>
          ) : null}
        </div>
        <div className="pc-toolbar__filter" role="group" aria-label="Какие заявки учитывать в прогнозе">
          <span className="text-muted">В прогнозе:</span>
          <Link href={toggleHref(true)} className={includePending ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} aria-current={includePending}>
            согласованные и на согласовании
          </Link>
          <Link href={toggleHref(false)} className={!includePending ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} aria-current={!includePending}>
            только согласованные
          </Link>
        </div>
      </div>

      <div className="pc-legend text-muted">
        <span><i className="pc-swatch pc-swatch--approved" /> согласована</span>
        <span><i className="pc-swatch pc-swatch--pending" /> на согласовании{pendingRequests.length ? ` (${pendingRequests.length})` : ""}</span>
        <span><i className="pc-swatch pc-swatch--done" /> оплачена / отклонена — не в прогнозе</span>
        <span><i className="pc-swatch pc-swatch--off" /> выходной или праздник</span>
      </div>

      <PaymentCalendarBoard weeks={boardWeeks} requests={boardRequests} canMove={canMove} todayKey={todayKey} />

      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Прогноз по дням с движением денег (все месяцы)</summary>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поступления</th>
                <th>Платежи</th>
                <th>Прогнозный остаток</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <td className="mono">
                    <Link href={`/payment-calendar?month=${row.date.slice(0, 7)}${includePending ? "" : "&pending=0"}`}>
                      {new Date(`${row.date}T00:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" })}
                    </Link>
                  </td>
                  <td className="mono">{row.inflow.greaterThan(0) ? formatMoney(row.inflow) : "—"}</td>
                  <td className="mono">{row.outflow.greaterThan(0) ? formatMoney(row.outflow) : "—"}</td>
                  <td className="mono" style={{ fontWeight: 700, color: row.balance.lessThan(0) ? "var(--color-danger)" : undefined }}>
                    {formatMoney(row.balance)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-state">
                    Нет ожидаемых движений денег.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
