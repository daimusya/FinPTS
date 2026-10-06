import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, sumMoney } from "@/lib/money";
import { PAYROLL_RUN_KIND_LABELS, PAYROLL_RUN_STATUS_BADGE, PAYROLL_RUN_STATUS_LABELS } from "@/lib/payroll/labels";
import {
  addPayrollLineAction,
  approvePayrollRunAction,
  calculatePayrollRunAction,
  markPayrollRunPaidAction,
  removePayrollLineAction,
} from "../actions";
import { AverageEarningsCard } from "./average-earnings-card";
import { isVisible } from "@/lib/access-guard";
import type { AverageParams } from "@/lib/payroll/average-earnings-db";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { singleParams } from "@/lib/query-params";
import { SubmitButton } from "@/components/submit-button";
import { payrollEmployeeWhere, payrollWorkMonth } from "@/lib/payroll/run-month";

export default async function PayrollRunDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string } & AverageParams>;
}) {
  const { id } = await params;
  const sp = singleParams(await searchParams);
  const { error } = sp;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.PAYROLL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.PAYROLL_MANAGE);
  const canPay = hasPermission(session, PERMISSIONS.CASH_MANAGE);

  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      organization: true,
      lines: { include: { employee: true, accrualType: true, department: true, project: true } },
    },
  });
  if (!run) notFound();
  if (!(await isVisible(session, "payrollRun", id))) notFound();

  // The main document on the payout date and, for vacations running into later months, one per month.
  const accrualDocuments = await prisma.accrualDocument.findMany({
    where: { sourceSystem: "payroll", OR: [{ externalId: run.id }, { externalId: { startsWith: `${run.id}:` } }] },
    orderBy: { date: "asc" },
  });

  const [employees, accrualTypes, departments, projects] = await Promise.all([
    // Also those dismissed during the run's work month (final pay, unused-vacation compensation).
    prisma.employee.findMany({ where: payrollEmployeeWhere(run.organizationId, payrollWorkMonth(run.kind, run.payoutDate).start), orderBy: { fullName: "asc" } }),
    prisma.payrollAccrualType.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);

  const totalAmount = sumMoney(run.lines.map((l) => l.amount));
  const totalNdfl = sumMoney(run.lines.map((l) => l.ndflAmount));
  const totalInsurance = sumMoney(run.lines.map((l) => l.insuranceAmount));
  const cashTotal = sumMoney(run.lines.filter((l) => l.employee.paymentMethod === "CASH").map((l) => l.amount));
  const bankTotal = sumMoney(run.lines.filter((l) => l.employee.paymentMethod !== "CASH").map((l) => l.amount));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            {PAYROLL_RUN_KIND_LABELS[run.kind]} · {run.organization.shortName || run.organization.name}
          </h1>
          <p>Дата выплаты: {run.payoutDate.toLocaleDateString("ru-RU")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/payroll" className="btn btn-secondary">
            К списку
          </Link>
          {canManage && (run.status === "DRAFT" || run.status === "CALCULATED") && run.kind !== "ADHOC" ? (
            <form action={calculatePayrollRunAction.bind(null, run.id)}>
              <SubmitButton className="btn btn-primary">
                {run.status === "DRAFT" ? "Рассчитать" : "Пересчитать"}
              </SubmitButton>
            </form>
          ) : null}
          {canManage && run.status === "CALCULATED" ? (
            <form action={approvePayrollRunAction.bind(null, run.id)}>
              <SubmitButton className="btn btn-primary">
                Утвердить
              </SubmitButton>
            </form>
          ) : null}
          {canPay && run.status === "APPROVED" ? (
            <form action={markPayrollRunPaidAction.bind(null, run.id)}>
              <SubmitButton className="btn btn-secondary">
                Отметить выплаченным
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>

      {error ? <p className="form-error" style={{ marginBottom: 14 }}>{error}</p> : null}

      {accrualDocuments.length > 0 ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p>
            Начисление проведено в ОПиУ:{" "}
            {accrualDocuments.map((d, i) => (
              <span key={d.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/accruals/${d.id}`}>документ № {d.number}</Link> от {d.date.toLocaleDateString("ru-RU", { timeZone: "UTC" })}
              </span>
            ))}
            .
          </p>
          {accrualDocuments.length > 1 ? (
            <p className="text-muted" style={{ marginTop: 6 }}>
              Отпускные и больничные за дни следующих месяцев отнесены в расход этих месяцев — отдельными документами.
            </p>
          ) : null}
        </div>
      ) : run.status === "APPROVED" || run.status === "PAID" ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="text-muted">
            Ни одна строка расчёта не привязана к статье ОПиУ (в справочнике «Виды начислений зарплаты»), поэтому
            документ начисления не создан — расход по этому расчёту нужно провести вручную.
          </p>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Статус</div>
          <div className="stat-value" style={{ fontSize: 16 }}>
            <span className={`badge ${PAYROLL_RUN_STATUS_BADGE[run.status]}`}>{PAYROLL_RUN_STATUS_LABELS[run.status]}</span>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Итого к начислению</div>
          <div className="stat-value">{formatMoney(totalAmount)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">НДФЛ</div>
          <div className="stat-value">{formatMoney(totalNdfl)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Страховые взносы</div>
          <div className="stat-value">{formatMoney(totalInsurance)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Наличными</div>
          <div className="stat-value">{formatMoney(cashTotal)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Безналично</div>
          <div className="stat-value">{formatMoney(bankTotal)}</div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Строки расчёта</h2>
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Вид начисления</th>
                <th>Подразделение</th>
                <th>Проект</th>
                <th>Сумма</th>
                <th>НДФЛ</th>
                <th>Взносы</th>
                <th>К выплате</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {run.lines.map((line) => (
                <tr key={line.id}>
                  <td>{line.employee.fullName}</td>
                  <td>
                    {line.accrualType.name}
                    {line.comment ? (
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {line.comment}
                      </div>
                    ) : null}
                  </td>
                  <td>{line.department?.name ?? "—"}</td>
                  <td>{line.project?.name ?? "—"}</td>
                  <td className="mono">{formatMoney(line.amount)}</td>
                  <td className="mono">{formatMoney(line.ndflAmount)}</td>
                  <td className="mono">{formatMoney(line.insuranceAmount)}</td>
                  <td className="mono">{formatMoney(line.amount.minus(line.ndflAmount))}</td>
                  <td>
                    {canManage && run.status !== "PAID" ? (
                      <form action={removePayrollLineAction.bind(null, run.id, line.id)}>
                        <ConfirmSubmitButton className="btn btn-ghost btn-sm" message="Удалить строку из расчёта зарплаты?">
                          Удалить
                        </ConfirmSubmitButton>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {run.lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Строк пока нет. Нажмите «Рассчитать» или добавьте строку вручную.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {canManage && run.status !== "PAID" ? (
          <>
            <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Добавить строку вручную</h3>
            <form action={addPayrollLineAction.bind(null, run.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
              <label className="field">
                <span>Сотрудник</span>
                <select name="employeeId" required>
                  <option value="">— выбрать —</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.fullName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Вид начисления</span>
                <select name="accrualTypeId" required>
                  <option value="">— выбрать —</option>
                  {accrualTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Сумма</span>
                <input type="number" step="0.01" name="amount" required />
              </label>
              <label className="field">
                <span>Подразделение</span>
                <select name="departmentId">
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Проект</span>
                <select name="projectId">
                  <option value="">—</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <SubmitButton className="btn btn-secondary">
                Добавить
              </SubmitButton>
            </form>
          </>
        ) : null}
      </div>

      {canManage && (run.status === "DRAFT" || run.status === "CALCULATED") ? (
        <AverageEarningsCard runId={run.id} employees={employees} params={sp} />
      ) : null}
    </div>
  );
}
