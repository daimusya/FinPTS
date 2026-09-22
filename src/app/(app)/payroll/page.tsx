import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { PAYROLL_RUN_KIND_LABELS, PAYROLL_RUN_STATUS_BADGE, PAYROLL_RUN_STATUS_LABELS } from "@/lib/payroll/labels";
import { formatMoney, sumMoney } from "@/lib/money";
import { getAccessScope, payrollRunScopeWhere } from "@/lib/access-scope";

export default async function PayrollRunsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра расчётов зарплаты.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.PAYROLL_MANAGE);

  const scope = await getAccessScope(session);
  const runs = await prisma.payrollRun.findMany({
    where: payrollRunScopeWhere(scope),
    orderBy: { payoutDate: "desc" },
    include: { organization: true, lines: true },
  });

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Расчёты зарплаты</h1>
          <p>Аванс — 25 число, окончательный расчёт — 10 число следующего месяца.</p>
        </div>
        {canManage ? (
          <Link href="/payroll/new" className="btn btn-primary">
            Новый расчёт
          </Link>
        ) : null}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата выплаты</th>
              <th>Организация</th>
              <th>Вид</th>
              <th>Сумма</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td className="mono">{run.payoutDate.toLocaleDateString("ru-RU")}</td>
                <td>
                  <Link href={`/payroll/${run.id}`}>{run.organization.shortName || run.organization.name}</Link>
                </td>
                <td>{PAYROLL_RUN_KIND_LABELS[run.kind]}</td>
                <td className="mono">{formatMoney(sumMoney(run.lines.map((l) => l.amount)))}</td>
                <td>
                  <span className={`badge ${PAYROLL_RUN_STATUS_BADGE[run.status]}`}>{PAYROLL_RUN_STATUS_LABELS[run.status]}</span>
                </td>
              </tr>
            ))}
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty-state">
                  Расчётов пока нет.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
