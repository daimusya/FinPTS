import { prisma } from "@/lib/db";
import { PeriodStatus } from "@prisma/client";

export default async function DashboardPage() {
  const [
    organizations,
    departments,
    counterparties,
    projects,
    employees,
    openPeriods,
    accrualDocuments,
  ] = await Promise.all([
    prisma.organization.count({ where: { isArchived: false } }),
    prisma.department.count({ where: { isArchived: false } }),
    prisma.counterparty.count({ where: { isArchived: false } }),
    prisma.project.count({ where: { isArchived: false } }),
    prisma.employee.count(),
    prisma.accountingPeriod.count({ where: { status: PeriodStatus.OPEN } }),
    prisma.accrualDocument.count(),
  ]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Дашборд</h1>
          <p>Структурные показатели платформы на текущий момент. Данные читаются напрямую из базы.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Организации и ИП" value={organizations} />
        <StatCard label="Подразделения" value={departments} />
        <StatCard label="Контрагенты" value={counterparties} />
        <StatCard label="Проекты" value={projects} />
        <StatCard label="Сотрудники" value={employees} />
        <StatCard label="Открытые периоды" value={openPeriods} />
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
          Управленческая отчётность (ДДС, ОПиУ, баланс, маржинальность)
        </h2>
        <p className="text-muted">
          Расчётное ядро отчётности подключается на Этапе 3, после ввода первичных
          документов начисления и банковских операций. Сейчас в системе {accrualDocuments}{" "}
          документ(ов) начисления — отчёты появятся здесь, как только будут данные,
          и будут вычисляться из сохранённых регистров, а не из статичных значений.
        </p>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
