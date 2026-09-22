import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, sumMoney } from "@/lib/money";

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

  const runs = await prisma.payrollRun.findMany({
    where: { payoutDate: { gte: from, lte: to } },
    include: {
      organization: true,
      lines: {
        include: { employee: { include: { department: true } }, department: true, project: true },
      },
    },
  });

  const allLines = runs.flatMap((r) => r.lines.map((l) => ({ ...l, organization: r.organization })));

  const cashTotal = sumMoney(allLines.filter((l) => l.employee.paymentMethod === "CASH").map((l) => l.amount.minus(l.ndflAmount)));
  const bankTotal = sumMoney(
    allLines.filter((l) => l.employee.paymentMethod !== "CASH").map((l) => l.amount.minus(l.ndflAmount)),
  );
  const ndflTotal = sumMoney(allLines.map((l) => l.ndflAmount));
  const insuranceTotal = sumMoney(allLines.map((l) => l.insuranceAmount));
  const grossTotal = sumMoney(allLines.map((l) => l.amount));
  // Итоговая денежная потребность компании = начисленная сумма (включая НДФЛ,
  // который удерживается из неё и перечисляется отдельно) + страховые взносы
  // сверх зарплаты.
  const cashNeedTotal = grossTotal.plus(insuranceTotal);

  const byOrg = new Map<string, { name: string; net: ReturnType<typeof sumMoney> }>();
  const byDept = new Map<string, { name: string; net: ReturnType<typeof sumMoney> }>();
  const byProject = new Map<string, { name: string; net: ReturnType<typeof sumMoney> }>();
  const byEmployee = new Map<string, { name: string; net: ReturnType<typeof sumMoney>; method: string }>();

  for (const line of allLines) {
    const net = line.amount.minus(line.ndflAmount);
    const orgKey = line.organization.id;
    byOrg.set(orgKey, { name: line.organization.shortName || line.organization.name, net: (byOrg.get(orgKey)?.net ?? sumMoney([])).plus(net) });

    const deptKey = line.department?.id ?? "none";
    byDept.set(deptKey, { name: line.department?.name ?? "Без подразделения", net: (byDept.get(deptKey)?.net ?? sumMoney([])).plus(net) });

    const projKey = line.project?.id ?? "none";
    if (line.project) {
      byProject.set(projKey, { name: line.project.name, net: (byProject.get(projKey)?.net ?? sumMoney([])).plus(net) });
    }

    const empKey = line.employeeId;
    byEmployee.set(empKey, {
      name: line.employee.fullName,
      net: (byEmployee.get(empKey)?.net ?? sumMoney([])).plus(net),
      method: line.employee.paymentMethod,
    });
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Сводная ведомость на выбранную дату</h1>
          <p>Сумма всех расчётов зарплаты с датой выплаты {from.toLocaleDateString("ru-RU")}, независимо от статуса.</p>
        </div>
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
          <div className="stat-value">{formatMoney(cashTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">К выплате безналично</div>
          <div className="stat-value">{formatMoney(bankTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">НДФЛ</div>
          <div className="stat-value">{formatMoney(ndflTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Страховые взносы</div>
          <div className="stat-value">{formatMoney(insuranceTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Итоговая денежная потребность</div>
          <div className="stat-value">{formatMoney(cashNeedTotal)}</div>
        </div>
      </div>

      <BreakdownTable title="По организациям" rows={Array.from(byOrg.values())} />
      <BreakdownTable title="По подразделениям" rows={Array.from(byDept.values())} />
      {byProject.size > 0 ? <BreakdownTable title="По проектам" rows={Array.from(byProject.values())} /> : null}
      <BreakdownTable
        title="По сотрудникам"
        rows={Array.from(byEmployee.values()).map((e) => ({ name: `${e.name} (${e.method === "CASH" ? "нал." : "безнал."})`, net: e.net }))}
      />

      {runs.length === 0 ? <div className="card">На эту дату расчётов зарплаты нет.</div> : null}
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: Array<{ name: string; net: ReturnType<typeof sumMoney> }> }) {
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
              <tr key={row.name}>
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
