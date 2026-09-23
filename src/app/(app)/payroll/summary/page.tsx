import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, toDecimal } from "@/lib/money";
import { computePayrollSummary, type PayrollSummaryLine } from "@/lib/payroll/summary";
import { getAccessScope, payrollRunScopeWhere } from "@/lib/access-scope";
import type Decimal from "decimal.js";

export default async function PayrollSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра сводной ведомости.</div>
      </div>
    );
  }

  const sp = await searchParams;
  const date = sp.date ? new Date(sp.date) : new Date();
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59));

  const scope = await getAccessScope(session);
  const runs = await prisma.payrollRun.findMany({
    where: { payoutDate: { gte: from, lte: to }, ...payrollRunScopeWhere(scope) },
    include: {
      organization: true,
      lines: {
        include: { employee: { include: { department: true } }, department: true, project: true },
      },
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
  const dateStr = from.toISOString().slice(0, 10);
  const exportHref = `/api/reports/export?type=payroll-summary&date=${dateStr}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Сводная ведомость на выбранную дату</h1>
          <p>Сумма всех расчётов зарплаты с датой выплаты {from.toLocaleDateString("ru-RU")}, независимо от статуса.</p>
        </div>
        <a href={exportHref} className="btn btn-secondary">
          Экспорт в Excel
        </a>
      </div>

      <form className="filter-bar">
        <label className="field">
          <span>Дата выплаты</span>
          <input type="date" name="date" defaultValue={from.toISOString().slice(0, 10)} />
        </label>
        <button type="submit" className="btn btn-secondary">
          Показать
        </button>
      </form>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">К выплате наличными</div>
          <div className="stat-value">{formatMoney(summary.cashTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">К выплате безналично</div>
          <div className="stat-value">{formatMoney(summary.bankTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">НДФЛ</div>
          <div className="stat-value">{formatMoney(summary.ndflTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Страховые взносы</div>
          <div className="stat-value">{formatMoney(summary.insuranceTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Итоговая денежная потребность</div>
          <div className="stat-value">{formatMoney(summary.cashNeedTotal)}</div>
        </div>
      </div>

      <BreakdownTable title="По организациям" rows={summary.byOrganization} />
      <BreakdownTable title="По подразделениям" rows={summary.byDepartment} />
      {summary.byProject.length > 0 ? <BreakdownTable title="По проектам" rows={summary.byProject} /> : null}
      <BreakdownTable
        title="По сотрудникам"
        rows={summary.byEmployee.map((e) => ({ key: e.key, name: `${e.name} (${e.paymentMethod === "CASH" ? "нал." : "безнал."})`, net: e.net }))}
      />

      {runs.length === 0 ? <div className="card">На эту дату расчётов зарплаты нет.</div> : null}
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Array<{ key: string; name: string; net: Decimal }> }) {
  if (rows.length === 0) return null;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>К выплате</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.name}</td>
                <td className="mono">{formatMoney(row.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
