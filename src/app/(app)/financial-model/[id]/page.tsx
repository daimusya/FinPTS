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
import { addNewServiceAction, removeNewServiceAction, saveScenarioValuesAction } from "../actions";
import { loadNewServices, MAX_RAMP_UP_MONTHS } from "@/lib/financial-model/new-services";

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
  searchParams: Promise<{ startYear?: string; startMonth?: string; error?: string }>;
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
  const [newServiceInputs, newServiceRows, products] = await Promise.all([
    loadNewServices([id]).then((m) => m.get(id) ?? []),
    prisma.financialScenarioNewService.findMany({
      where: { scenarioId: id },
      include: { productService: true },
      orderBy: [{ launchYear: "asc" }, { launchMonth: "asc" }, { name: "asc" }],
    }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);
  const projection = projectScenario(startYear, startMonth, HORIZON_MONTHS, rows, startingCash, newServiceInputs);
  const keepStart = (
    <>
      <input type="hidden" name="startYear" value={startYear} />
      <input type="hidden" name="startMonth" value={startMonth} />
    </>
  );

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

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Новые услуги</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          С месяца запуска каждая услуга добавляет к выручке сценария: средний чек × продажи в месяц × доля выхода на
          мощность × сезонность сценария. При выходе на полную мощность за N месяцев продажи растут линейно: 1/N в месяц
          запуска, 2/N во второй и т.д. Переменные расходы — свой % услуги или, если не задан, % сценария.
        </p>
        {sp.error ? (
          <p className="form-error" style={{ marginBottom: 12 }}>
            {sp.error}
          </p>
        ) : null}
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Услуга</th>
                <th>Запуск</th>
                <th>Средний чек</th>
                <th>Продаж в месяц (полная мощность)</th>
                <th>Выход на мощность</th>
                <th>Переменные расходы</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {newServiceRows.map((service) => (
                <tr key={service.id}>
                  <td>
                    {service.name}
                    {service.productService && service.productService.name !== service.name ? (
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {service.productService.name}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    {MONTH_NAMES_SHORT[service.launchMonth - 1]} {service.launchYear}
                  </td>
                  <td className="mono">{formatMoney(service.avgCheck)}</td>
                  <td className="mono">{formatNumber(service.salesPerMonth)}</td>
                  <td>{service.rampUpMonths > 1 ? `${service.rampUpMonths} мес.` : "сразу"}</td>
                  <td>{service.variableCostPct === null ? "как у сценария" : `${formatNumber(service.variableCostPct)}%`}</td>
                  <td>
                    {canManage ? (
                      <form action={removeNewServiceAction.bind(null, id, service.id)}>
                        {keepStart}
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Удалить
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {newServiceRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty-state">
                    Новых услуг в сценарии нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <form action={addNewServiceAction.bind(null, id)} className="form-grid" style={{ alignItems: "flex-end" }}>
            {keepStart}
            <label className="field">
              <span>Название</span>
              <input type="text" name="name" placeholder="или выберите из справочника →" />
            </label>
            <label className="field">
              <span>Из справочника «Продукты и услуги»</span>
              <select name="productServiceId" defaultValue="">
                <option value="">—</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Месяц запуска</span>
              <input type="month" name="launch" required />
            </label>
            <label className="field">
              <span>Средний чек, ₽</span>
              <input type="text" inputMode="decimal" name="avgCheck" required style={{ width: 120 }} />
            </label>
            <label className="field">
              <span>Продаж в месяц</span>
              <input type="text" inputMode="decimal" name="salesPerMonth" required style={{ width: 100 }} />
            </label>
            <label className="field">
              <span>Выход на мощность, мес.</span>
              <input type="number" name="rampUpMonths" min={0} max={MAX_RAMP_UP_MONTHS} step={1} placeholder="0 — сразу" style={{ width: 110 }} />
            </label>
            <label className="field">
              <span>Переменные расходы, %</span>
              <input type="text" inputMode="decimal" name="variableCostPct" placeholder="как у сценария" style={{ width: 120 }} />
            </label>
            <button type="submit" className="btn btn-secondary">
              Добавить услугу
            </button>
          </form>
        ) : null}
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
              {newServiceInputs.length > 0 ? (
                <>
                  <ProjectionRow label="Выручка — база (драйверы)" values={projection.map((p) => p.baseRevenue)} format="money" />
                  {newServiceInputs.map((service) => (
                    <ProjectionRow
                      key={service.id}
                      label={`Выручка — ${service.name}`}
                      values={projection.map((p) => p.newServices.find((s) => s.id === service.id)?.revenue ?? null)}
                      format="money"
                    />
                  ))}
                  <ProjectionRow label="Выручка итого" values={projection.map((p) => p.revenue)} format="money" bold />
                </>
              ) : (
                <ProjectionRow label="Выручка" values={projection.map((p) => p.revenue)} format="money" />
              )}
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
