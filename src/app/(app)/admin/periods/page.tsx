import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { createPeriodAction, reopenPeriodAction } from "./actions";
import type { ClosingSnapshot } from "@/lib/period-close/snapshot";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default async function PeriodsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PERIODS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для управления периодами.</div>
      </div>
    );
  }
  const canReopen = hasPermission(session, PERMISSIONS.PERIODS_REOPEN);

  const periods = await prisma.accountingPeriod.findMany({
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { closedBy: true, reopenedBy: true, checks: true },
  });

  const now = new Date();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Учётные периоды</h1>
          <p>
            Закрытый период запрещает изменение документов. Перед закрытием проходит контрольный
            лист — критические ошибки блокируют закрытие, предупреждения требуют осознанного
            подтверждения.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16, maxWidth: 420 }}>
        <form action={createPeriodAction} className="form-grid" style={{ alignItems: "flex-end" }}>
          <label className="field">
            <span>Год</span>
            <input type="number" name="year" defaultValue={now.getFullYear()} required />
          </label>
          <label className="field">
            <span>Месяц</span>
            <select name="month" defaultValue={now.getMonth() + 1} required>
              {MONTH_NAMES.map((label, idx) => (
                <option key={label} value={idx + 1}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn btn-primary">
            Создать период
          </button>
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Период</th>
              <th>Статус</th>
              <th>Закрыт</th>
              <th>Повторно открыт</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const failedChecks = period.checks.filter((c) => !c.passed);
              const snapshot = period.closingSnapshot as ClosingSnapshot | null;
              return (
                <tr key={period.id}>
                  <td>
                    {MONTH_NAMES[period.month - 1]} {period.year}
                  </td>
                  <td>
                    <span className={`badge ${period.status === "OPEN" ? "badge-active" : "badge-danger"}`}>
                      {period.status === "OPEN" ? "Открыт" : "Закрыт"}
                    </span>
                  </td>
                  <td className="text-muted">
                    {period.closedBy ? (
                      <>
                        {period.closedBy.fullName}, {period.closedAt?.toLocaleString("ru-RU")}
                        {failedChecks.length > 0 ? (
                          <>
                            {" "}
                            <span className="badge badge-warning">{failedChecks.length} предупр.</span>
                          </>
                        ) : null}
                        {snapshot ? (
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ cursor: "pointer" }}>Показатели на момент закрытия</summary>
                            <div style={{ marginTop: 6, fontSize: 12 }}>
                              <div>Остаток денег: {formatMoney(snapshot.cashClosing)}</div>
                              <div>Выручка за период: {formatMoney(snapshot.revenue)}</div>
                              <div>Чистая прибыль: {formatMoney(snapshot.netProfit)}</div>
                              <div>Дебиторка: {formatMoney(snapshot.receivable)}</div>
                              <div>Кредиторка: {formatMoney(snapshot.payable)}</div>
                            </div>
                          </details>
                        ) : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-muted">
                    {period.reopenedBy
                      ? `${period.reopenedBy.fullName}, ${period.reopenedAt?.toLocaleString("ru-RU")}`
                      : "—"}
                  </td>
                  <td>
                    {period.status === "OPEN" ? (
                      <Link href={`/admin/periods/${period.id}/close`} className="btn btn-danger btn-sm">
                        Закрыть период
                      </Link>
                    ) : canReopen ? (
                      <form action={reopenPeriodAction.bind(null, period.id)}>
                        <button type="submit" className="btn btn-secondary btn-sm">
                          Открыть заново
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {periods.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  Периодов пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
