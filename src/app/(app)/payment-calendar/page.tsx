import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { buildCalendarRows, type ExpectedMovement } from "@/lib/payment-calendar";
import { formatMoney, sumMoney } from "@/lib/money";

export default async function PaymentCalendarPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра платёжного календаря.</div>
      </div>
    );
  }

  const [transactions, unpaidDocuments, approvedRequests] = await Promise.all([
    prisma.bankTransaction.findMany({ select: { amount: true, direction: true } }),
    prisma.accrualDocument.findMany({
      where: { status: "POSTED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
      include: { lines: true, allocations: { where: { cancelledAt: null } }, counterparty: true },
    }),
    prisma.paymentRequest.findMany({
      where: { status: "APPROVED" },
      include: { organization: true, counterparty: true },
    }),
  ]);

  const inflow = sumMoney(transactions.filter((t) => t.direction === "INFLOW").map((t) => t.amount));
  const outflow = sumMoney(transactions.filter((t) => t.direction === "OUTFLOW").map((t) => t.amount));
  const currentBalance = inflow.minus(outflow);

  const movements: ExpectedMovement[] = [];
  for (const doc of unpaidDocuments) {
    const total = sumMoney(doc.lines.map((l) => l.amount));
    const allocated = sumMoney(doc.allocations.map((a) => a.amount));
    const remaining = total.minus(allocated);
    if (remaining.lessThanOrEqualTo(0)) continue;
    movements.push({
      date: doc.dueDate ?? doc.date,
      amount: remaining.toString(),
      direction: doc.direction === "INCOME" ? "INFLOW" : "OUTFLOW",
    });
  }
  for (const req of approvedRequests) {
    movements.push({ date: req.dueDate, amount: req.amount.toString(), direction: "OUTFLOW" });
  }

  const rows = buildCalendarRows(currentBalance.toString(), movements);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Платёжный календарь</h1>
          <p>
            Прогноз остатка денег строится от текущего фактического остатка по всем счетам и кассам на основе
            непогашенных начислений (по сроку оплаты) и согласованных заявок на оплату.
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
          <div className="stat-value">
            {formatMoney(sumMoney(movements.filter((m) => m.direction === "INFLOW").map((m) => m.amount)))}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Ожидаемые платежи</div>
          <div className="stat-value">
            {formatMoney(sumMoney(movements.filter((m) => m.direction === "OUTFLOW").map((m) => m.amount)))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p className="text-muted">
          Известное ограничение: остаток считается как сумма всех операций «поступление минус списание» по всем
          счетам и кассам. Если перевод между своими счетами внесён только одной строкой (без встречной), общий
          остаток может быть немного занижен/завышен — заведите обе стороны перевода как отдельные операции.
        </p>
      </div>

      <div className="table-wrap">
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
                <td className="mono">{new Date(row.date).toLocaleDateString("ru-RU")}</td>
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
                  Нет ожидаемых движений денег — все начисления оплачены, заявок на согласовании нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
