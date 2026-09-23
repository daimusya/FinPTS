import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { formatMoney, formatNumber, sumMoney } from "@/lib/money";
import { GENERAL_DRIVERS, DEPARTMENT_DRIVERS, MONTH_NAMES_SHORT, SCENARIO_TYPE_LABELS } from "@/lib/financial-model/drivers";
import { projectScenario, type ScenarioValueRow } from "@/lib/financial-model/project";
import { getCurrentCashBalance } from "@/lib/financial-model/current-cash";
import { getAccessScope } from "@/lib/access-scope";
import { saveScenarioValuesAction } from "../actions";

const HORIZON_MONTHS = 12;

function addMonths(year: number, month: number, offset: number) {
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export default async function ScenarioDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ startYear?: string; startMonth?: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав.</div>
      </div>
    );
  }
  const canManage = hasPermission(session, PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const scenario = await prisma.financialScenario.findUnique({ where: { id }, include: { values: true } });
  if (!scenario) notFound();

  const sp = await searchParams;
  const now = new Date();
  const startYear = Number(sp.startYear) || now.getFullYear();
  const startMonth = Number(sp.startMonth) || now.getMonth() + 1;
  const months = Array.from({ length: HORIZON_MONTHS }, (_, i) => addMonths(startYear, startMonth, i));

  let departments = await prisma.department.findMany({
    where: { isArchived: false, name: { in: ["Отдел обучения", "Отдел охраны труда"] } },
    orderBy: { name: "asc" },
  });
  if (departments.length === 0) {
    departments = await prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" }, take: 6 });
  }

  const valueMap = new Map<string, string>();
  for (const v of scenario.values) {
    valueMap.set(`${v.driver}-${v.dimension ?? ""}-${v.year}-${v.month}`, String(v.value));
  }
  function cellValue(driver: string, year: number, month: number, dimension: string | null = null) {
    return valueMap.get(`${driver}-${dimension ?? ""}-${year}-${month}`) ?? "";
  }
  function fieldName(driver: string, year: number, month: number, dimension: string | null = null) {
    return dimension ? `v__${driver}__${dimension}__${year}_${month}` : `v__${driver}__${year}_${month}`;
  }

  const scope = await getAccessScope(session);
  const startingCash = await getCurrentCashBalance(scope);
  const rows: ScenarioValueRow[] = scenario.values.map((v) => ({
    year: v.year,
    month: v.month,
    driver: v.driver,
    dimension: v.dimension,
    value: v.value.toString(),
  }));
  const projection = projectScenario(startYear, startMonth, HORIZON_MONTHS, rows, startingCash);

  const totalRevenue = sumMoney(projection.map((p) => p.revenue));
  const totalOperatingProfit = sumMoney(projection.map((p) => p.operatingProfit));
  const finalCash = projection[projection.length - 1]?.cashBalance ?? sumMoney([]);
  const exportHref = `/api/reports/export?type=scenario-forecast&scenarioId=${id}&startYear=${startYear}&startMonth=${startMonth}`;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            {scenario.name} <span className="badge badge-orange">{SCENARIO_TYPE_LABELS[scenario.type] ?? scenario.type}</span>
          </h1>
          <p>
            Прогноз на 12 месяцев с {MONTH_NAMES_SHORT[startMonth - 1]} {startYear}. Текущий фактический остаток денег
            ({formatMoney(startingCash)}) взят как стартовая точка прогноза.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={exportHref} className="btn btn-secondary">
            Экспорт в Excel
          </a>
          <Link href="/financial-model" className="btn btn-secondary">
            К списку
          </Link>
        </div>
      </div>

      <form className="filter-bar">
        <label className="field">
          <span>Год начала</span>
          <input type="number" name="startYear" defaultValue={startYear} style={{ width: 90 }} />
        </label>
        <label className="field">
          <span>Месяц начала</span>
          <input type="number" name="startMonth" min="1" max="12" defaultValue={startMonth} style={{ width: 70 }} />
        </label>
        <button type="submit" className="btn btn-secondary">
          Показать
        </button>
      </form>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-label">Выручка за 12 месяцев</div>
          <div className="stat-value">{formatMoney(totalRevenue)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Операционная прибыль за 12 месяцев</div>
          <div className="stat-value">{formatMoney(totalOperatingProfit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Остаток денег на конец горизонта</div>
          <div className="stat-value">{formatMoney(finalCash)}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Драйверы сценария</h2>
        <form action={saveScenarioValuesAction.bind(null, id)}>
          <div className="table-wrap" style={{ marginBottom: 14 }}>
            <table>
              <thead>
                <tr>
                  <th style={{ position: "sticky", left: 0, background: "var(--color-graphite-50)" }}>Драйвер</th>
                  {months.map((m) => (
                    <th key={`${m.year}-${m.month}`}>
                      {MONTH_NAMES_SHORT[m.month - 1]} {m.year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {GENERAL_DRIVERS.map((driver) => (
                  <tr key={driver.code}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {driver.label} <span className="text-muted">({driver.unit})</span>
                    </td>
                    {months.map((m) => (
                      <td key={`${m.year}-${m.month}`}>
                        <input
                          type="number"
                          step="0.01"
                          style={{ width: 90 }}
                          name={fieldName(driver.code, m.year, m.month)}
                          defaultValue={cellValue(driver.code, m.year, m.month)}
                          disabled={!canManage}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
                {DEPARTMENT_DRIVERS.map((driver) =>
                  departments.map((dept) => (
                    <tr key={`${driver.code}-${dept.id}`}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {driver.label}: {dept.name} <span className="text-muted">({driver.unit})</span>
                      </td>
                      {months.map((m) => (
                        <td key={`${m.year}-${m.month}`}>
                          <input
                            type="number"
                            step="0.01"
                            style={{ width: 90 }}
                            name={fieldName(driver.code, m.year, m.month, dept.id)}
                            defaultValue={cellValue(driver.code, m.year, m.month, dept.id)}
                            disabled={!canManage}
                          />
                        </td>
                      ))}
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <button type="submit" className="btn btn-primary">
              Сохранить драйверы
            </button>
          ) : null}
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Прогноз</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Показатель</th>
                {months.map((m) => (
                  <th key={`${m.year}-${m.month}`}>
                    {MONTH_NAMES_SHORT[m.month - 1]} {m.year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <ProjectionRow label="Выручка" values={projection.map((p) => p.revenue)} format="money" />
              <ProjectionRow label="Переменные расходы" values={projection.map((p) => p.variableCosts)} format="money" />
              <ProjectionRow label="Комиссия посредников" values={projection.map((p) => p.intermediaryCommission)} format="money" />
              <ProjectionRow label="Валовая прибыль" values={projection.map((p) => p.grossProfit)} format="money" bold />
              <ProjectionRow label="Постоянные расходы" values={projection.map((p) => p.fixedCosts)} format="money" />
              <ProjectionRow label="ФОТ" values={projection.map((p) => p.payrollCost)} format="money" />
              <ProjectionRow label="Требуемая численность" values={projection.map((p) => p.totalHeadcount)} format="number" />
              <ProjectionRow label="Операционная прибыль" values={projection.map((p) => p.operatingProfit)} format="money" bold />
              <ProjectionRow label="Точка безубыточности" values={projection.map((p) => p.breakEvenRevenue)} format="money" />
              <ProjectionRow label="Запас прочности, %" values={projection.map((p) => p.marginOfSafetyPct)} format="pct" />
              <ProjectionRow label="Остаток денег" values={projection.map((p) => p.cashBalance)} format="money" bold />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ProjectionRow({
  label,
  values,
  format,
  bold,
}: {
  label: string;
  values: Array<import("decimal.js").default | number | null>;
  format: "money" | "number" | "pct";
  bold?: boolean;
}) {
  return (
    <tr style={{ fontWeight: bold ? 700 : 400 }}>
      <td style={{ whiteSpace: "nowrap" }}>{label}</td>
      {values.map((v, idx) => (
        <td key={idx} className="mono">
          {v === null
            ? "—"
            : format === "money"
              ? formatMoney(v)
              : format === "pct"
                ? `${formatNumber(v)}%`
                : formatNumber(v)}
        </td>
      ))}
    </tr>
  );
}
