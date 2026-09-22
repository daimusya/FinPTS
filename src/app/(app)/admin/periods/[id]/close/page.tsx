import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { runPeriodCloseChecklist } from "@/lib/period-close/checklist";
import { closePeriodAction } from "../../actions";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

export default async function ClosePeriodPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PERIODS_MANAGE)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }

  const period = await prisma.accountingPeriod.findUnique({ where: { id } });
  if (!period) notFound();
  if (period.status === "CLOSED") {
    return (
      <div className="page">
        <div className="card">
          Период {MONTH_NAMES[period.month - 1]} {period.year} уже закрыт.{" "}
          <Link href="/admin/periods">Назад к списку</Link>
        </div>
      </div>
    );
  }

  const results = await runPeriodCloseChecklist(period.year, period.month);
  const hasCritical = results.some((r) => r.severity === "critical" && !r.passed);
  const hasWarning = results.some((r) => r.severity === "warning" && !r.passed);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            Закрытие периода: {MONTH_NAMES[period.month - 1]} {period.year}
          </h1>
          <p>Контрольный лист проверяется каждый раз перед закрытием — результаты сохраняются в истории периода.</p>
        </div>
        <Link href="/admin/periods" className="btn btn-secondary">
          Назад
        </Link>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead>
            <tr>
              <th>Проверка</th>
              <th>Важность</th>
              <th>Результат</th>
              <th>Сообщение</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.checkType}>
                <td>{r.label}</td>
                <td>
                  <span className={`badge ${r.severity === "critical" ? "badge-danger" : "badge-warning"}`}>
                    {r.severity === "critical" ? "Критично" : "Предупреждение"}
                  </span>
                </td>
                <td>
                  <span className={`badge ${r.passed ? "badge-active" : "badge-danger"}`}>
                    {r.passed ? "OK" : "Есть проблемы"}
                  </span>
                </td>
                <td className="text-muted">{r.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        {hasCritical ? (
          <p className="form-error">
            Есть критические ошибки — закрытие периода заблокировано, пока они не будут исправлены.
          </p>
        ) : (
          <form action={closePeriodAction.bind(null, period.id)}>
            {hasWarning ? (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 13 }}>
                <input type="checkbox" name="acknowledgeWarnings" required />
                Я ознакомился с предупреждениями и осознанно закрываю период
              </label>
            ) : (
              <p className="form-success" style={{ marginBottom: 14 }}>
                Все проверки пройдены без замечаний.
              </p>
            )}
            <button type="submit" className="btn btn-danger">
              Закрыть период
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
