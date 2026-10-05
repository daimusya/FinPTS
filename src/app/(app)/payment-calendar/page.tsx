import Link from "next/link";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import {
  accountKey,
  adjacentMonths,
  buildCalendarRows,
  buildMonthGrid,
  HIDDEN_REQUEST_STATUSES,
  itemScope,
  localDateKey,
  parseAccountKey,
  requestPlacement,
  type CalendarDay,
  type CalendarMovement,
  type ForecastScope,
} from "@/lib/payment-calendar";
import { formatMoney, sumMoney } from "@/lib/money";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payment-requests/labels";
import { ACCRUAL_DOCUMENT_TYPE_LABELS } from "@/lib/accruals/labels";
import { canPlanDocuments, canPlanRequests } from "@/lib/payment-plan/service";
import { PaymentCalendarBoard, type AccountOption, type BoardDay, type BoardItem } from "@/components/payment-calendar-board";
import { formatMoneyIn, normalizeCurrency } from "@/lib/currency";
import { amountInRub, loadRateLookup } from "@/lib/currency-rates";
import { isForeign, outstanding } from "@/lib/accruals/currency";
import {
  accrualScopeWhere,
  bankTransactionScopeWhere,
  getAccessScope,
  organizationIdScopeWhere,
  organizationScopeWhere,
  paymentRequestScopeWhere,
} from "@/lib/access-scope";
import { MissingRatesWarning } from "@/components/missing-rates-warning";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";

const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const WEEKDAY_NAMES = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

const compact = new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 });
const short = (value: Decimal) => compact.format(value.toNumber());
const showDay = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });
const keyOf = (d: Date) => d.toISOString().slice(0, 10);

/** Худшая точка месяца: минимум по концу дня и по провалам внутри дня. */
function lowestPoint(weeks: CalendarDay[][]): { date: string; value: Decimal; time: string | null; intraday: boolean } | null {
  let best: { date: string; value: Decimal; time: string | null; intraday: boolean } | null = null;
  for (const d of weeks.flat()) {
    if (!d.inMonth || !d.balance) continue;
    const point = d.lowWithinDay
      ? { date: d.date, value: d.lowWithinDay, time: d.lowTime, intraday: true }
      : { date: d.date, value: d.balance, time: null, intraday: false };
    if (!best || point.value.lessThan(best.value)) best = point;
  }
  return best;
}

const showPoint = (p: { date: string; time: string | null; intraday: boolean }) =>
  p.intraday ? `${showDay(p.date)}, ${p.time ? `в ${p.time}` : "с начала дня"}` : `${showDay(p.date)}, на конец дня`;

/** Платёж календаря до отбора по срезу: знает свою организацию и счёт оплаты. */
type Item = Omit<BoardItem, "unassigned"> & { amountValue: Decimal };

export default async function PaymentCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; pending?: string; org?: string; account?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра платёжного календаря.</div>
      </div>
    );
  }
  const planRequests = canPlanRequests(session);
  const planDocuments = canPlanDocuments(session);

  const params = singleParams(await searchParams);
  const todayKey = localDateKey();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "") ? params.month! : todayKey.slice(0, 7);
  const includePending = params.pending !== "0";
  const { prev, next } = adjacentMonths(month);
  const [year, monthNumber] = month.split("-").map(Number);

  // Only the organizations, accounts, documents and requests this user may see.
  const access = await getAccessScope(session);
  const orgScope = organizationIdScopeWhere(access);
  const [organizations, bankAccounts, cashAccounts, flows, unpaidDocuments, requests, calendarDays, rates] = await Promise.all([
    prisma.organization.findMany({ where: { isArchived: false, ...organizationScopeWhere(access) }, orderBy: { name: "asc" } }),
    prisma.bankAccount.findMany({ where: orgScope, include: { organization: true }, orderBy: { bankName: "asc" } }),
    prisma.cashAccount.findMany({ where: orgScope, include: { organization: true }, orderBy: { name: "asc" } }),
    prisma.bankTransaction.groupBy({ by: ["bankAccountId", "cashAccountId", "direction"], where: bankTransactionScopeWhere(access), _sum: { amount: true } }),
    prisma.accrualDocument.findMany({
      where: { status: "POSTED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...accrualScopeWhere(access) },
      include: { lines: true, allocations: { where: { cancelledAt: null } }, counterparty: true, organization: true },
    }),
    prisma.paymentRequest.findMany({
      where: { status: { notIn: [...HIDDEN_REQUEST_STATUSES] }, ...paymentRequestScopeWhere(access) },
      include: { organization: true, counterparty: true, cashFlowArticle: true, parts: { orderBy: [{ dueDate: "asc" }, { sortOrder: "asc" }] } },
      orderBy: [{ dueDate: "asc" }, { amount: "desc" }],
    }),
    prisma.productionCalendarDay.findMany({
      where: { isArchived: false, date: { gte: new Date(Date.UTC(year, monthNumber - 2, 20)), lte: new Date(Date.UTC(year, monthNumber, 10)) } },
    }),
    loadRateLookup(),
  ]);

  // Accounts: names, organization, current balance from bank and cash operations.
  const accountInfo = new Map<string, { label: string; organizationId: string; organization: string; archived: boolean; currency: string }>();
  for (const a of bankAccounts) {
    accountInfo.set(`bank:${a.id}`, {
      label: `${a.bankName} · ${a.accountNumber}`,
      organizationId: a.organizationId,
      organization: a.organization.shortName || a.organization.name,
      archived: a.isArchived,
      currency: normalizeCurrency(a.currency),
    });
  }
  for (const a of cashAccounts) {
    accountInfo.set(`cash:${a.id}`, {
      label: `Касса «${a.name}»`,
      organizationId: a.organizationId,
      organization: a.organization.shortName || a.organization.name,
      archived: a.isArchived,
      currency: normalizeCurrency(a.currency),
    });
  }
  // Balance of each account in its own currency, and in rubles at today's rate (the forecast is in rubles).
  const nativeBalances = new Map<string, Decimal>();
  for (const f of flows) {
    const key = accountKey(f.bankAccountId, f.cashAccountId);
    if (!key) continue;
    const amount = new Decimal(f._sum.amount?.toString() ?? 0);
    nativeBalances.set(key, (nativeBalances.get(key) ?? new Decimal(0)).plus(f.direction === "INFLOW" ? amount : amount.negated()));
  }
  const todayDate = new Date(`${todayKey}T00:00:00Z`);
  const balances = new Map<string, Decimal>();
  for (const [key, native] of nativeBalances) balances.set(key, rates.toRub(native, accountInfo.get(key)?.currency ?? "RUB", todayDate));

  // Forecast slice: one account, one organization or everything.
  const chosenAccount = parseAccountKey(params.account) && accountInfo.has(params.account!) ? params.account! : null;
  const chosenOrg = chosenAccount
    ? accountInfo.get(chosenAccount)!.organizationId
    : organizations.some((o) => o.id === params.org)
      ? params.org!
      : null;
  const scope: ForecastScope = {
    organizationId: chosenAccount ? null : chosenOrg,
    accountKey: chosenAccount,
    accountOrganizationId: chosenAccount ? chosenOrg : null,
  };
  const accountsInScope = [...accountInfo.entries()].filter(([key, info]) =>
    chosenAccount ? key === chosenAccount : chosenOrg ? info.organizationId === chosenOrg : true,
  );
  const currentBalance = accountsInScope.reduce((sum, [key]) => sum.plus(balances.get(key) ?? 0), new Decimal(0));

  // Every planned payment: requests (or their parts) and unpaid documents.
  const items: Item[] = [];
  for (const r of requests) {
    const placement = requestPlacement(r.status, includePending);
    const statusLabel = PAYMENT_REQUEST_STATUS_LABELS[r.status];
    const base = {
      href: `/payment-requests/${r.id}`,
      direction: "OUTFLOW" as const,
      title: r.counterparty ? r.counterparty.shortName || r.counterparty.fullName : "Без контрагента",
      organizationId: r.organizationId,
      organization: r.organization.shortName || r.organization.name,
      article: r.cashFlowArticle?.name ?? null,
      accountKey: accountKey(r.payBankAccountId, r.payCashAccountId),
    };
    const look = r.status === "APPROVED" ? "approved" : placement.movable ? "pending" : "done";
    // A request in a foreign currency: roubles at today's rate (the forecast is in roubles).
    const toRub = (value: { toString(): string }) =>
      r.currency === "RUB" ? new Decimal(value.toString()) : (amountInRub(value.toString(), r.currency, rates, todayDate) ?? new Decimal(value.toString()));
    const inCurrency = (value: { toString(): string }) => (r.currency === "RUB" ? "" : ` · ${formatMoneyIn(value.toString(), r.currency)}`);
    if (r.parts.length === 0) {
      const amount = toRub(r.amount);
      items.push({
        ...base,
        kind: "request",
        id: r.id,
        dueDate: keyOf(r.dueDate),
        dueTime: r.dueTime,
        amount: short(amount),
        amountFull: formatMoney(amount),
        amountValue: amount,
        subtitle: `Заявка · ${statusLabel}${inCurrency(r.amount)}`,
        look,
        counted: placement.counted,
        movable: placement.movable && planRequests,
        accountName: null,
      });
      continue;
    }
    r.parts.forEach((part, i) => {
      const amount = toRub(part.amount);
      const ownAccount = accountKey(part.payBankAccountId, part.payCashAccountId);
      items.push({
        ...base,
        // A part may be paid from its own account; otherwise the request's.
        accountKey: ownAccount ?? base.accountKey,
        accountInherited: !ownAccount && Boolean(base.accountKey),
        kind: "part",
        id: part.id,
        dueDate: keyOf(part.dueDate),
        dueTime: part.dueTime,
        amount: short(amount),
        amountFull: formatMoney(amount),
        amountValue: amount,
        subtitle: `Часть ${i + 1} из ${r.parts.length} · ${part.paidAt ? "оплачена" : statusLabel}${inCurrency(part.amount)}`,
        look: part.paidAt ? "done" : look,
        counted: placement.counted && !part.paidAt,
        movable: placement.movable && planRequests && !part.paidAt,
        accountName: null,
      });
    });
  }
  for (const doc of unpaidDocuments) {
    // A document in a foreign currency: the remainder at today's rate (the forecast is in roubles).
    const foreignDoc = isForeign(doc.currency);
    const left = outstanding(doc, foreignDoc ? rates.rateOn(doc.currency, todayDate) : null);
    const remaining = left.rub;
    if (left.native.lessThanOrEqualTo(0)) continue;
    const income = doc.direction === "INCOME";
    items.push({
      kind: "document",
      id: doc.id,
      href: `/accruals/${doc.id}`,
      dueDate: keyOf(doc.dueDate ?? doc.date),
      dueTime: doc.dueDate ? doc.dueTime : null,
      direction: income ? "INFLOW" : "OUTFLOW",
      amount: short(remaining),
      amountFull: formatMoney(remaining),
      amountValue: remaining,
      title: doc.counterparty.shortName || doc.counterparty.fullName,
      subtitle: `${ACCRUAL_DOCUMENT_TYPE_LABELS[doc.documentType]} № ${doc.number} · ${income ? "к получению" : "к оплате"}${doc.paymentStatus === "PARTIALLY_PAID" ? " (остаток)" : ""}${foreignDoc ? ` · ${formatMoneyIn(left.native, doc.currency)}` : ""}`,
      organizationId: doc.organizationId,
      organization: doc.organization.shortName || doc.organization.name,
      article: null,
      look: income ? "doc-in" : "doc-out",
      counted: true,
      movable: planDocuments,
      accountKey: accountKey(doc.plannedBankAccountId, doc.plannedCashAccountId),
      accountName: null,
    });
  }
  for (const item of items) item.accountName = item.accountKey ? (accountInfo.get(item.accountKey)?.label ?? null) : null;

  const toMovement = (item: Item): CalendarMovement => ({
    date: new Date(`${item.dueDate}T00:00:00Z`),
    amount: item.amountValue.toString(),
    direction: item.direction,
    time: item.dueTime,
    source: item.kind === "document" ? "document" : "request",
  });
  const scoped = items.map((item) => ({ item, where: itemScope(item, scope) })).filter((x) => x.where !== "out");
  const movements = scoped.filter((x) => x.where === "in" && x.item.counted).map((x) => toMovement(x.item));

  const calendar = new Map(
    // A shortened pre-holiday day is still a working day.
    calendarDays.map((d) => [keyOf(d.date), { kind: d.kind === "holiday" ? ("holiday" as const) : ("workday" as const), name: d.name }]),
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
      low: d.lowWithinDay ? short(d.lowWithinDay) : null,
      lowFull: d.lowWithinDay ? formatMoney(d.lowWithinDay) : null,
      lowTime: d.lowTime,
      lowNegative: Boolean(d.lowWithinDay?.lessThan(0)),
    })),
  );

  const gridFirst = weeks[0][0].date;
  const gridLast = weeks[weeks.length - 1][6].date;
  const boardItems: BoardItem[] = scoped
    // Overdue unpaid payments are always shown (in their own strip); the rest only within the visible weeks.
    .filter(({ item }) => (item.movable && item.dueDate < todayKey) || (item.dueDate >= gridFirst && item.dueDate <= gridLast))
    .map(({ item, where }) => {
      const { amountValue, ...rest } = item;
      void amountValue;
      return { ...rest, unassigned: where === "unassigned" };
    });

  // Future days only: overdue items fall on today, as in the grid.
  const rows = buildCalendarRows(
    currentBalance.toString(),
    movements.map((m) => (keyOf(m.date) < todayKey ? { ...m, date: todayDate } : m)),
  );
  const lowest = lowestPoint(weeks);
  const expectedIn = sumMoney(movements.filter((m) => m.direction === "INFLOW").map((m) => m.amount));
  const expectedOut = sumMoney(movements.filter((m) => m.direction === "OUTFLOW").map((m) => m.amount));
  const pendingCount = requests.filter((r) => r.status === "PENDING_APPROVAL" || r.status === "DRAFT").length;

  // Forecast per account for the visible month: each account with the payments assigned to it.
  const tableAccounts = [...accountInfo.entries()].filter(
    ([key, info]) =>
      (chosenOrg ? info.organizationId === chosenOrg : true) && (!info.archived || !(balances.get(key) ?? new Decimal(0)).isZero()),
  );
  const accountRows = tableAccounts.map(([key, info]) => {
    const own = items.filter((i) => i.accountKey === key && i.counted).map(toMovement);
    const grid = buildMonthGrid({ month, todayKey, startingBalance: balances.get(key) ?? 0, movements: own, calendar });
    const days = grid.flat().filter((d) => d.inMonth && d.balance);
    const low = lowestPoint(grid);
    return {
      key,
      info,
      native: nativeBalances.get(key) ?? new Decimal(0),
      balance: balances.get(key) ?? new Decimal(0),
      inflow: sumMoney(own.filter((m) => m.direction === "INFLOW").map((m) => m.amount)),
      outflow: sumMoney(own.filter((m) => m.direction === "OUTFLOW").map((m) => m.amount)),
      monthEnd: days.at(-1)?.balance ?? null,
      low,
    };
  });
  const unassignedCounted = items.filter((i) => !i.accountKey && i.counted && (chosenOrg ? i.organizationId === chosenOrg : true));
  const unassignedIn = sumMoney(unassignedCounted.filter((i) => i.direction === "INFLOW").map((i) => i.amountValue));
  const unassignedOut = sumMoney(unassignedCounted.filter((i) => i.direction === "OUTFLOW").map((i) => i.amountValue));

  const accountsByOrganization: Record<string, AccountOption[]> = {};
  for (const [key, info] of accountInfo) {
    if (info.archived) continue;
    (accountsByOrganization[info.organizationId] ??= []).push({ key, label: info.label });
  }

  const href = (overrides: Record<string, string | null>) => {
    const values: Record<string, string | null> = {
      month,
      pending: includePending ? null : "0",
      org: chosenAccount ? null : chosenOrg,
      account: chosenAccount,
      ...overrides,
    };
    const query = Object.entries(values)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
      .join("&");
    return `/payment-calendar${query ? `?${query}` : ""}`;
  };
  const sliceName = chosenAccount
    ? `${accountInfo.get(chosenAccount)!.organization}: ${accountInfo.get(chosenAccount)!.label}`
    : chosenOrg
      ? (organizations.find((o) => o.id === chosenOrg)?.shortName || organizations.find((o) => o.id === chosenOrg)?.name)
      : "все счета и кассы";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Платёжный календарь</h1>
          <p>
            Прогноз остатка от фактического остатка на счетах: непогашенные документы начислений и заявки на оплату (в том числе
            по частям). Платёж можно перетащить на другой день — срок оплаты перенесётся. У платежа можно указать время: остаток
            считается и в течение дня — платёж без времени в начале дня, поступление без времени в конце, — так видно, хватит ли
            денег на утренние платежи до дневных поступлений.
          </p>
        </div>
      </div>

      {rates.missingText() ? <MissingRatesWarning text={rates.missingText()!} /> : null}

      <form className="filter-bar" method="get" action="/payment-calendar">
        <input type="hidden" name="month" value={month} />
        {includePending ? null : <input type="hidden" name="pending" value="0" />}
        <label className="field">
          <span>Организация</span>
          <select name="org" id="pc-org" defaultValue={chosenAccount ? "" : (chosenOrg ?? "")}>
            <option value="">Все организации</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.shortName || o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Счёт или касса</span>
          <select name="account" id="pc-account-filter" defaultValue={chosenAccount ?? ""}>
            <option value="">Все счета организации</option>
            {[...accountInfo.entries()]
              .filter(([, info]) => !info.archived)
              .map(([key, info]) => (
                <option key={key} value={key}>
                  {info.organization}: {info.label}
                </option>
              ))}
          </select>
        </label>
        <SubmitButton className="btn btn-secondary">
          Показать
        </SubmitButton>
        {chosenOrg || chosenAccount ? (
          <Link href={href({ org: null, account: null })} className="btn btn-ghost">
            Сбросить
          </Link>
        ) : null}
      </form>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Текущий остаток — {sliceName}</div>
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
          <div className="stat-value" style={{ color: lowest?.value.lessThan(0) ? "var(--color-danger)" : undefined }}>
            {lowest ? formatMoney(lowest.value) : "—"}
          </div>
          {lowest ? (
            <div className="text-muted" style={{ fontSize: 12 }}>
              {showPoint(lowest)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="pc-toolbar">
        <div className="pc-toolbar__nav">
          <Link href={href({ month: prev })} className="btn btn-secondary btn-sm" aria-label="Предыдущий месяц">
            ←
          </Link>
          <strong className="pc-toolbar__month">
            {MONTH_NAMES[monthNumber - 1]} {year}
          </strong>
          <Link href={href({ month: next })} className="btn btn-secondary btn-sm" aria-label="Следующий месяц">
            →
          </Link>
          {month !== todayKey.slice(0, 7) ? (
            <Link href={href({ month: null })} className="btn btn-ghost btn-sm">
              Сегодня
            </Link>
          ) : null}
        </div>
        <div className="pc-toolbar__filter" role="group" aria-label="Какие заявки учитывать в прогнозе">
          <span className="text-muted">Заявки в прогнозе:</span>
          <Link href={href({ pending: null })} className={includePending ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} aria-current={includePending}>
            согласованные и на согласовании
          </Link>
          <Link href={href({ pending: "0" })} className={!includePending ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"} aria-current={!includePending}>
            только согласованные
          </Link>
        </div>
      </div>

      <div className="pc-legend text-muted">
        <span>
          <i className="pc-swatch pc-swatch--approved" /> заявка согласована
        </span>
        <span>
          <i className="pc-swatch pc-swatch--pending" /> на согласовании{pendingCount ? ` (${pendingCount})` : ""}
        </span>
        <span>
          <i className="pc-swatch pc-swatch--doc-in" /> документ к получению
        </span>
        <span>
          <i className="pc-swatch pc-swatch--doc-out" /> документ к оплате
        </span>
        <span>
          <i className="pc-swatch pc-swatch--done" /> оплачено / отклонено — не в прогнозе
        </span>
        <span>
          <i className="pc-swatch pc-swatch--off" /> выходной или праздник
        </span>
      </div>

      <PaymentCalendarBoard weeks={boardWeeks} items={boardItems} todayKey={todayKey} accountsByOrganization={accountsByOrganization} />

      <div className="card" style={{ marginTop: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          Прогноз по счетам — {MONTH_NAMES[monthNumber - 1].toLowerCase()} {year}
        </h2>
        <p className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>
          У каждого счёта — только платежи, для которых он назначен счётом оплаты. Платежи без счёта — отдельной строкой: назначьте
          им счёт в календаре, на странице заявки или документа. Прогноз — в рублях: остаток валютного счёта пересчитан по курсу ЦБ
          на сегодня, суммы заявок и документов — рублёвые.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Счёт или касса</th>
                <th>Остаток сейчас</th>
                <th>Поступления</th>
                <th>Платежи</th>
                <th>На конец месяца</th>
                <th>Минимум в месяце</th>
              </tr>
            </thead>
            <tbody>
              {accountRows.map((row) => (
                <tr key={row.key} className={row.key === chosenAccount ? "row-selected" : undefined}>
                  <td>
                    <Link href={href({ account: row.key, org: null })}>{row.info.label}</Link>
                    <div className="text-muted" style={{ fontSize: 11 }}>
                      {row.info.organization}
                      {row.info.archived ? " · в архиве" : ""}
                    </div>
                  </td>
                  <td className="mono">
                    {row.info.currency === "RUB" ? (
                      formatMoney(row.balance)
                    ) : (
                      <>
                        {formatMoneyIn(row.native, row.info.currency)}
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          ≈ {formatMoney(row.balance)} по курсу ЦБ
                        </div>
                      </>
                    )}
                  </td>
                  <td className="mono">{row.inflow.greaterThan(0) ? formatMoney(row.inflow) : "—"}</td>
                  <td className="mono">{row.outflow.greaterThan(0) ? formatMoney(row.outflow) : "—"}</td>
                  <td className="mono">{row.monthEnd ? formatMoney(row.monthEnd) : "—"}</td>
                  <td className="mono" style={{ color: row.low?.value.lessThan(0) ? "var(--color-danger)" : undefined, fontWeight: row.low?.value.lessThan(0) ? 700 : undefined }}>
                    {row.low ? `${formatMoney(row.low.value)} · ${showPoint(row.low)}` : "—"}
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <span className="text-muted">Счёт оплаты не назначен</span>
                </td>
                <td className="mono">—</td>
                <td className="mono">{unassignedIn.greaterThan(0) ? formatMoney(unassignedIn) : "—"}</td>
                <td className="mono">{unassignedOut.greaterThan(0) ? formatMoney(unassignedOut) : "—"}</td>
                <td className="mono">—</td>
                <td className="mono">—</td>
              </tr>
              {accountRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-state">
                    Счетов и касс нет — заведите их в справочниках «Банковские счета» и «Кассы».
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Прогноз по дням с движением денег (все месяцы) — {sliceName}</summary>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Поступления</th>
                <th>Платежи</th>
                <th>Прогнозный остаток</th>
                <th>Минимум в течение дня</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date}>
                  <td className="mono">
                    <Link href={href({ month: row.date.slice(0, 7) })}>{showDay(row.date)}</Link>
                  </td>
                  <td className="mono">{row.inflow.greaterThan(0) ? formatMoney(row.inflow) : "—"}</td>
                  <td className="mono">{row.outflow.greaterThan(0) ? formatMoney(row.outflow) : "—"}</td>
                  <td className="mono" style={{ fontWeight: 700, color: row.balance.lessThan(0) ? "var(--color-danger)" : undefined }}>
                    {formatMoney(row.balance)}
                  </td>
                  <td className="mono" style={{ color: row.lowWithinDay?.lessThan(0) ? "var(--color-danger)" : undefined }}>
                    {row.lowWithinDay ? `${formatMoney(row.lowWithinDay)} · ${row.lowTime ? `в ${row.lowTime}` : "с начала дня"}` : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty-state">
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
