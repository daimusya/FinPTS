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
import {
  addLoanAction,
  addNewServiceAction,
  updateNewServiceAction,
  addScenarioDepartmentAction,
  removeLoanAction,
  removeNewServiceAction,
  removeScenarioDepartmentAction,
  saveScenarioTaxAction,
  saveScenarioValuesAction,
} from "../actions";
import { loadScenarioDepartments } from "@/lib/financial-model/scenario-departments";
import { loadLoans, loadOpeningBalances, loadScenarioTax, loadScenarioTaxContext, MAX_LOAN_TERM_MONTHS } from "@/lib/financial-model/loans";
import { organizationScopeWhere } from "@/lib/access-scope";
import { DEFAULT_TAX_RATES, TAX_REGIME_LABELS, TAX_REGIMES, usnVatLimit } from "@/lib/financial-model/taxes";
import { LOAN_REPAYMENT_LABELS, type LoanRepayment } from "@/lib/financial-model/cash-timing";
import { loadNewServices, MAX_PAYMENT_DAYS, MAX_RAMP_UP_MONTHS } from "@/lib/financial-model/new-services";

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
  searchParams: Promise<{ startYear?: string; startMonth?: string; error?: string; editService?: string }>;
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

  const [departments, allDepartments] = await Promise.all([
    loadScenarioDepartments(id),
    prisma.department.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
  ]);
  const addableDepartments = allDepartments.filter((d) => !departments.some((shown) => shown.id === d.id));

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
  const [newServiceInputs, newServiceRows, products, loanInputs, loanRows, opening] = await Promise.all([
    loadNewServices([id]).then((m) => m.get(id) ?? []),
    prisma.financialScenarioNewService.findMany({
      where: { scenarioId: id },
      include: { productService: true },
      orderBy: [{ launchYear: "asc" }, { launchMonth: "asc" }, { name: "asc" }],
    }),
    prisma.productService.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } }),
    loadLoans([id]).then((m) => m.get(id) ?? []),
    prisma.financialScenarioLoan.findMany({
      where: { scenarioId: id },
      orderBy: [{ startYear: "asc" }, { startMonth: "asc" }, { name: "asc" }],
    }),
    loadOpeningBalances(scope),
  ]);
  const [tax, taxOrganizations] = await Promise.all([
    loadScenarioTax(scenario, startYear),
    prisma.organization.findMany({ where: { isArchived: false, ...organizationScopeWhere(scope) }, orderBy: { name: "asc" } }),
  ]);
  const hasContribution = Boolean(tax.ipContribution);
  // Taxes or the sole proprietor's contributions — either one brings the profit-after-tax rows.
  const taxOn = tax.regime !== "none" || hasContribution;
  const taxContext = await loadScenarioTaxContext(tax, startYear, startMonth, scope);
  const yearOpening = taxContext.yearOpening ?? null;
  const vatContext = taxContext.vat ?? null;
  const usnVat = Boolean(vatContext?.usnExemption) && (tax.regime === "usn_income" || tax.regime === "usn_income_expense");
  const startLimit = usnVatLimit(startYear);
  const projection = projectScenario(startYear, startMonth, HORIZON_MONTHS, rows, startingCash, newServiceInputs, {
    ...opening,
    loans: loanInputs,
    ...taxContext,
  });
  const startIndex = startYear * 12 + (startMonth - 1);
  const dueLater = (due: typeof opening.openingReceivableDue) => sumMoney(due.filter((d) => d.index > startIndex).map((d) => d.amount));
  const totalNetProfit = sumMoney(projection.map((p) => p.netProfit));
  const finalDebt = projection[projection.length - 1]?.loanDebt ?? sumMoney([]);
  const noService = null as (typeof newServiceRows)[number] | null;
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
          <div className="stat-label">{taxOn ? "Чистая прибыль (после налога) за 12 месяцев" : "Прибыль после процентов за 12 месяцев"}</div>
          <div className="stat-value">{formatMoney(totalNetProfit)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Остаток денег на конец горизонта</div>
          <div className="stat-value">{formatMoney(finalCash)}</div>
        </div>
        {loanInputs.length > 0 ? (
          <div className="stat-card">
            <div className="stat-label">Долг по кредитам на конец горизонта</div>
            <div className="stat-value">{formatMoney(finalDebt)}</div>
          </div>
        ) : null}
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
                        {driver.label}: {dept.name}
                        {dept.isArchived ? " (в архиве)" : ""} <span className="text-muted">({driver.unit})</span>
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
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Подразделения в сценарии</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Для каждого подразделения в таблице драйверов задаются продажи и производительность на сотрудника — из них
          считается требуемая численность. Сохраните введённые драйверы перед добавлением или удалением подразделения:
          страница перезагрузится. Убрать подразделение — значит удалить и его продажи и производительность в этом
          сценарии.
        </p>
        <div className="tag-list" style={{ marginBottom: 12, alignItems: "center" }}>
          {departments.map((dept) => (
            <span key={dept.id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="badge badge-orange">
                {dept.name}
                {dept.isArchived ? " (в архиве)" : ""}
              </span>
              {canManage ? (
                <form action={removeScenarioDepartmentAction.bind(null, id, dept.id)}>
                  {keepStart}
                  <button type="submit" className="btn btn-ghost btn-sm" aria-label={`Убрать ${dept.name}`}>
                    Убрать
                  </button>
                </form>
              ) : null}
            </span>
          ))}
          {departments.length === 0 ? <span className="text-muted">Подразделений нет.</span> : null}
        </div>
        {canManage && addableDepartments.length > 0 ? (
          <form action={addScenarioDepartmentAction.bind(null, id)} className="form-grid" style={{ alignItems: "flex-end" }}>
            {keepStart}
            <label className="field">
              <span>Подразделение</span>
              <select name="departmentId" required defaultValue="">
                <option value="">— выбрать —</option>
                {addableDepartments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn btn-secondary">
              Добавить подразделение
            </button>
          </form>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Новые услуги</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          С месяца запуска каждая услуга добавляет к выручке сценария: средний чек × продажи в месяц × доля выхода на
          мощность × сезонность сценария. При выходе на полную мощность за N месяцев продажи растут линейно: 1/N в месяц
          запуска, 2/N во второй и т.д. Переменные расходы — свой % услуги или, если не задан, % сценария. Персонал
          услуги набирается вместе с выходом на мощность (полная численность × доля, с округлением вверх) — ФОТ по её
          стоимости сотрудника или средней по сценарию; постоянные расходы услуги — с месяца запуска, расходы на запуск —
          разово в месяц запуска. Всё это входит в общие ФОТ, численность и постоянные расходы, а вклад каждой услуги
          показан в прогнозе отдельной строкой.
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
                <th>Персонал</th>
                <th>Постоянные в мес. / на запуск</th>
                <th>Отсрочка клиентов</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {newServiceRows.map((service) =>
                canManage && sp.editService === service.id ? (
                  <tr key={service.id} className="row-editing">
                    <td colSpan={10}>
                      <form action={updateNewServiceAction.bind(null, id, service.id)} className="form-grid" style={{ alignItems: "flex-end" }}>
                        {keepStart}
                        <label className="field">
                          <span>Название</span>
                          <input type="text" name="name" defaultValue={service?.name ?? ""} placeholder="или выберите из справочника →" />
                        </label>
                        <label className="field">
                          <span>Из справочника «Продукты и услуги»</span>
                          <select name="productServiceId" defaultValue={service?.productServiceId ?? ""}>
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
                          <input type="month" name="launch" required defaultValue={service ? `${service.launchYear}-${String(service.launchMonth).padStart(2, "0")}` : ""} />
                        </label>
                        <label className="field">
                          <span>Средний чек, ₽</span>
                          <input type="text" inputMode="decimal" name="avgCheck" required defaultValue={service?.avgCheck.toString() ?? ""} style={{ width: 120 }} />
                        </label>
                        <label className="field">
                          <span>Продаж в месяц</span>
                          <input type="text" inputMode="decimal" name="salesPerMonth" required defaultValue={service?.salesPerMonth.toString() ?? ""} style={{ width: 100 }} />
                        </label>
                        <label className="field">
                          <span>Выход на мощность, мес.</span>
                          <input type="number" name="rampUpMonths" min={0} max={MAX_RAMP_UP_MONTHS} step={1} defaultValue={service?.rampUpMonths ?? ""} placeholder="0 — сразу" style={{ width: 110 }} />
                        </label>
                        <label className="field">
                          <span>Переменные расходы, %</span>
                          <input type="text" inputMode="decimal" name="variableCostPct" defaultValue={service?.variableCostPct?.toString() ?? ""} placeholder="как у сценария" style={{ width: 120 }} />
                        </label>
                        <label className="field">
                          <span>Персонал на полной мощности, чел.</span>
                          <input type="number" name="staffHeadcount" min={0} step={1} defaultValue={service?.staffHeadcount ?? ""} placeholder="нет" style={{ width: 110 }} />
                        </label>
                        <label className="field">
                          <span>Стоимость сотрудника в месяц, ₽</span>
                          <input type="text" inputMode="decimal" name="staffCostPerEmployee" defaultValue={service?.staffCostPerEmployee?.toString() ?? ""} placeholder="средняя по сценарию" style={{ width: 150 }} />
                        </label>
                        <label className="field">
                          <span>Постоянные расходы услуги в месяц, ₽</span>
                          <input type="text" inputMode="decimal" name="monthlyFixedCosts" defaultValue={service?.monthlyFixedCosts?.toString() ?? ""} placeholder="0" style={{ width: 140 }} />
                        </label>
                        <label className="field">
                          <span>Расходы на запуск (разово), ₽</span>
                          <input type="text" inputMode="decimal" name="launchCosts" defaultValue={service?.launchCosts?.toString() ?? ""} placeholder="0" style={{ width: 140 }} />
                        </label>
                        <label className="field">
                          <span>Отсрочка оплаты клиентов, дней</span>
                          <input type="number" name="customerPaymentDays" min={0} max={MAX_PAYMENT_DAYS} step={1} defaultValue={service?.customerPaymentDays ?? ""} placeholder="как у сценария" style={{ width: 130 }} />
                        </label>
                        <div className="form-actions">
                          <button type="submit" className="btn btn-primary btn-sm">
                            Сохранить
                          </button>
                          <Link href={`/financial-model/${id}?startYear=${startYear}&startMonth=${startMonth}`} className="btn btn-ghost btn-sm">
                            Отмена
                          </Link>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
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
                    {service.staffHeadcount
                      ? `${service.staffHeadcount} чел. × ${service.staffCostPerEmployee ? formatMoney(service.staffCostPerEmployee) : "средняя"}`
                      : "—"}
                  </td>
                  <td className="mono">
                    {service.monthlyFixedCosts || service.launchCosts
                      ? `${formatMoney(service.monthlyFixedCosts ?? 0)} / ${formatMoney(service.launchCosts ?? 0)}`
                      : "—"}
                  </td>
                  <td>{service.customerPaymentDays === null ? "как у сценария" : `${service.customerPaymentDays} дн.`}</td>
                  <td>
                    {canManage ? (
                      <div className="row-actions">
                        <Link href={`/financial-model/${id}?startYear=${startYear}&startMonth=${startMonth}&editService=${service.id}`} className="btn btn-ghost btn-sm">
                          Изменить
                        </Link>
                        <form action={removeNewServiceAction.bind(null, id, service.id)}>
                          {keepStart}
                          <button type="submit" className="btn btn-ghost btn-sm">
                            Удалить
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </td>
                </tr>
                ),
              )}
              {newServiceRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="empty-state">
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
              <input type="text" name="name" defaultValue={noService?.name ?? ""} placeholder="или выберите из справочника →" />
            </label>
            <label className="field">
              <span>Из справочника «Продукты и услуги»</span>
              <select name="productServiceId" defaultValue={noService?.productServiceId ?? ""}>
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
              <input type="month" name="launch" required defaultValue={noService ? `${noService.launchYear}-${String(noService.launchMonth).padStart(2, "0")}` : ""} />
            </label>
            <label className="field">
              <span>Средний чек, ₽</span>
              <input type="text" inputMode="decimal" name="avgCheck" required defaultValue={noService?.avgCheck.toString() ?? ""} style={{ width: 120 }} />
            </label>
            <label className="field">
              <span>Продаж в месяц</span>
              <input type="text" inputMode="decimal" name="salesPerMonth" required defaultValue={noService?.salesPerMonth.toString() ?? ""} style={{ width: 100 }} />
            </label>
            <label className="field">
              <span>Выход на мощность, мес.</span>
              <input type="number" name="rampUpMonths" min={0} max={MAX_RAMP_UP_MONTHS} step={1} defaultValue={noService?.rampUpMonths ?? ""} placeholder="0 — сразу" style={{ width: 110 }} />
            </label>
            <label className="field">
              <span>Переменные расходы, %</span>
              <input type="text" inputMode="decimal" name="variableCostPct" defaultValue={noService?.variableCostPct?.toString() ?? ""} placeholder="как у сценария" style={{ width: 120 }} />
            </label>
            <label className="field">
              <span>Персонал на полной мощности, чел.</span>
              <input type="number" name="staffHeadcount" min={0} step={1} defaultValue={noService?.staffHeadcount ?? ""} placeholder="нет" style={{ width: 110 }} />
            </label>
            <label className="field">
              <span>Стоимость сотрудника в месяц, ₽</span>
              <input type="text" inputMode="decimal" name="staffCostPerEmployee" defaultValue={noService?.staffCostPerEmployee?.toString() ?? ""} placeholder="средняя по сценарию" style={{ width: 150 }} />
            </label>
            <label className="field">
              <span>Постоянные расходы услуги в месяц, ₽</span>
              <input type="text" inputMode="decimal" name="monthlyFixedCosts" defaultValue={noService?.monthlyFixedCosts?.toString() ?? ""} placeholder="0" style={{ width: 140 }} />
            </label>
            <label className="field">
              <span>Расходы на запуск (разово), ₽</span>
              <input type="text" inputMode="decimal" name="launchCosts" defaultValue={noService?.launchCosts?.toString() ?? ""} placeholder="0" style={{ width: 140 }} />
            </label>
            <label className="field">
              <span>Отсрочка оплаты клиентов, дней</span>
              <input type="number" name="customerPaymentDays" min={0} max={MAX_PAYMENT_DAYS} step={1} defaultValue={noService?.customerPaymentDays ?? ""} placeholder="как у сценария" style={{ width: 130 }} />
            </label>
            <button type="submit" className="btn btn-secondary">
              Добавить услугу
            </button>
          </form>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Кредиты</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          Деньги по кредиту приходят в месяц получения, со следующего месяца — платежи по графику. Проценты (остаток
          долга × ставка / 12) — расход: уменьшают прибыль после процентов и деньги. Погашение основного долга — только
          отток денег. Льготный период — первые месяцы платятся только проценты, долг гасится за оставшийся срок.
          Досрочное погашение — разовая сумма сверх платежа в выбранный месяц; срок сохраняется, дальше платёж
          пересчитывается на новый остаток. Для разовых платежей без графика остаётся драйвер «Прочие платежи по
          кредитам/лизингу».
        </p>
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Кредит</th>
                <th>Сумма</th>
                <th>Получение</th>
                <th>Ставка, % годовых</th>
                <th>Срок, мес.</th>
                <th>Погашение</th>
                <th>Льготный период</th>
                <th>Досрочно</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loanRows.map((loan) => (
                <tr key={loan.id}>
                  <td>{loan.name}</td>
                  <td className="mono">{formatMoney(loan.amount)}</td>
                  <td>
                    {MONTH_NAMES_SHORT[loan.startMonth - 1]} {loan.startYear}
                  </td>
                  <td>{formatNumber(loan.annualRatePct)}</td>
                  <td>{loan.termMonths}</td>
                  <td>{LOAN_REPAYMENT_LABELS[loan.repayment as LoanRepayment] ?? loan.repayment}</td>
                  <td>{loan.graceMonths > 0 ? `${loan.graceMonths} мес.` : "—"}</td>
                  <td>
                    {loan.prepaymentAmount && loan.prepaymentMonth && loan.prepaymentYear
                      ? `${formatMoney(loan.prepaymentAmount)} в ${MONTH_NAMES_SHORT[loan.prepaymentMonth - 1]} ${loan.prepaymentYear}`
                      : "—"}
                  </td>
                  <td>
                    {canManage ? (
                      <form action={removeLoanAction.bind(null, id, loan.id)}>
                        {keepStart}
                        <button type="submit" className="btn btn-ghost btn-sm">
                          Удалить
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
              {loanRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty-state">
                    Кредитов в сценарии нет.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <form action={addLoanAction.bind(null, id)} className="form-grid" style={{ alignItems: "flex-end" }}>
            {keepStart}
            <label className="field">
              <span>Название</span>
              <input type="text" name="name" required placeholder="например, кредит на оборудование" />
            </label>
            <label className="field">
              <span>Сумма, ₽</span>
              <input type="text" inputMode="decimal" name="amount" required style={{ width: 130 }} />
            </label>
            <label className="field">
              <span>Месяц получения</span>
              <input type="month" name="start" required />
            </label>
            <label className="field">
              <span>Ставка, % годовых</span>
              <input type="text" inputMode="decimal" name="annualRatePct" placeholder="0 — без процентов" style={{ width: 110 }} />
            </label>
            <label className="field">
              <span>Срок, мес.</span>
              <input type="number" name="termMonths" min={1} max={MAX_LOAN_TERM_MONTHS} step={1} required style={{ width: 90 }} />
            </label>
            <label className="field">
              <span>Погашение</span>
              <select name="repayment" defaultValue="annuity">
                {(Object.keys(LOAN_REPAYMENT_LABELS) as LoanRepayment[]).map((r) => (
                  <option key={r} value={r}>
                    {LOAN_REPAYMENT_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Льготный период, мес.</span>
              <input type="number" name="graceMonths" min={0} max={MAX_LOAN_TERM_MONTHS - 1} step={1} placeholder="0 — нет" style={{ width: 110 }} />
            </label>
            <label className="field">
              <span>Досрочное погашение: месяц</span>
              <input type="month" name="prepayment" />
            </label>
            <label className="field">
              <span>Досрочно, ₽</span>
              <input type="text" inputMode="decimal" name="prepaymentAmount" placeholder="необязательно" style={{ width: 130 }} />
            </label>
            <button type="submit" className="btn btn-secondary">
              Добавить кредит
            </button>
          </form>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Налог</h2>
        <p className="text-muted" style={{ marginBottom: 12 }}>
          «Как у организации» — система налогообложения и ставки из карточки организации (справочник «Организации и
          ИП», блок «Налоги и ставки»; ставка каждого года — действующая на 1 января). УСН и АУСН «доходы» — ставка ×
          деньги от клиентов; «доходы минус расходы» и ЕСХН — ставка × (полученное − оплаченные расходы), за год не
          меньше 1% (УСН) или 3% (АУСН) доходов; налог на прибыль — ставка × прибыль после процентов. Налог считается
          нарастающим итогом с начала года в пределах прогноза (убыток уменьшает налог года). Уплата: УСН и налог на
          прибыль — в апреле, июле и октябре за квартал и в марте за год; ЕСХН — в июле и марте; АУСН — каждый месяц
          за предыдущий. Налог уменьшает чистую прибыль и деньги. Своя ставка не указана — стандартная. НДС, патент
          и налоги прошлых периодов не считаются. НДС: выручка и расходы прогноза — без НДС; клиенты платят выручку плюс
          НДС, при ставках 22% и 10% НДС поставщиков (переменные расходы и комиссия) идёт к вычету, при 5% и 7% вычетов нет;
          НДС за квартал уплачивается тремя равными частями в следующие три месяца; вычет — и по постоянным расходам
          (доля — драйвер «Постоянные расходы с входящим НДС»). На УСН НДС нет, пока доход не превышает лимит года. На
          прибыль НДС не влияет. До даты регистрации и после даты прекращения деятельности организации выручки, расходов и
          ФОТ в прогнозе нет. Взносы ИП за
          неполный год — по датам регистрации и прекращения деятельности из карточки; при прекращении всё за год
          уплачивается в течение 15 дней. У ИП «как у организации» считаются и взносы за себя из карточки:
          фиксированные — равными долями по месяцам, уплата в декабре; с дохода свыше порога — нарастающим итогом за год,
          не больше максимума, уплата в июле следующего года. При УСН «доходы» «как у организации» налог уменьшается
          на страховые взносы с начала года: у ИП без сотрудников — на взносы за себя полностью; при сотрудниках (по
          справочнику «Сотрудники» или с месяца, когда в прогнозе численность больше нуля) — на взносы за себя и за
          сотрудников (их доля в ФОТ по ставке взносов организации), но не больше чем на 50% налога. При других режимах
          взносы ИП за себя — расход.
        </p>
        <form action={saveScenarioTaxAction.bind(null, id)} className="form-grid" style={{ alignItems: "flex-end" }}>
          {keepStart}
          <label className="field">
            <span>Режим</span>
            <select name="taxRegime" defaultValue={scenario.taxRegime} disabled={!canManage}>
              <option value="organization">Как у организации</option>
              {TAX_REGIMES.map((r) => (
                <option key={r} value={r}>
                  {TAX_REGIME_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Организация (для «как у организации»)</span>
            <select name="taxOrganizationId" defaultValue={scenario.taxOrganizationId ?? ""} disabled={!canManage}>
              <option value="">—</option>
              {taxOrganizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.shortName || o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Своя ставка, %</span>
            <input
              type="text"
              inputMode="decimal"
              name="taxRatePct"
              defaultValue={scenario.taxRatePct?.toString() ?? ""}
              placeholder={scenario.taxRegime !== "organization" && taxOn ? `стандартная ${DEFAULT_TAX_RATES[tax.regime]}` : "стандартная"}
              style={{ width: 130 }}
              disabled={!canManage}
            />
          </label>
          <label className="field">
            <span>НДС, % (при своём режиме)</span>
            <input
              type="text"
              inputMode="decimal"
              name="vatRatePct"
              defaultValue={scenario.vatRatePct?.toString() ?? ""}
              placeholder="не считать"
              style={{ width: 130 }}
              disabled={!canManage}
            />
          </label>
          {canManage ? (
            <button type="submit" className="btn btn-secondary">
              Сохранить налог
            </button>
          ) : null}
          <span className="text-muted">Сейчас: {tax.label}</span>
        </form>
        {vatContext ? (
          <p className="text-muted" style={{ marginTop: 10 }}>
            НДС до начала прогноза по проведённым документам («в т.ч. НДС»): прошлый квартал — начислено{" "}
            {formatMoney(vatContext.opening?.previousQuarter.output ?? 0)}, к вычету {formatMoney(vatContext.opening?.previousQuarter.input ?? 0)}
            {" "}(его трети уплачиваются в первые месяцы квартала начала прогноза); месяцы этого квартала до прогноза — начислено{" "}
            {formatMoney(vatContext.opening?.currentQuarter.output ?? 0)}, к вычету {formatMoney(vatContext.opening?.currentQuarter.input ?? 0)}.
            {usnVat
              ? startLimit === null
                ? " До 2025 года УСН НДС не платит."
                : ` Освобождение от НДС на УСН: доход за ${startYear - 1} год по банку и кассе — ${formatMoney(vatContext.usnExemption!.previousYearIncome)}, лимит ${startYear} года — ${formatMoney(startLimit)}; ${vatContext.usnExemption!.previousYearIncome.lessThanOrEqualTo(startLimit) ? "освобождение действует, пока доход с начала года не превысит лимит (НДС — со следующего месяца)" : "лимит превышен — НДС платится весь год"}.`
              : ""}
          </p>
        ) : null}
        {yearOpening ? (
          <p className="text-muted" style={{ marginTop: 10 }}>
            Факт с 1 января {yearOpening.year} до начала прогноза{tax.organizationId ? " по организации" : " по всем доступным организациям"}:
            поступления {formatMoney(yearOpening.income)}, платежи {formatMoney(yearOpening.expenses)}, прибыль до налога{" "}
            {formatMoney(yearOpening.profit)}. Налог, порог взносов 1% и минимальный налог считаются за весь год с учётом
            этого факта; налог за эти месяцы считается уплаченным вне прогноза.
          </p>
        ) : null}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Прогноз</h2>
        <p className="text-muted" style={{ marginBottom: 10 }}>
          Деньги: выручка поступает с отсрочкой оплаты клиентов, переменные расходы и комиссия оплачиваются с
          отсрочкой оплаты поставщикам (драйверы в днях; у новой услуги может быть своя отсрочка клиентов), постоянные
          расходы и ФОТ — в том же месяце. Фактическая дебиторка ({formatMoney(opening.openingReceivable)}) и кредиторка с
          зарплатой к выплате ({formatMoney(opening.openingPayable)}) на сегодня погашаются по срокам оплаты документов
          (срок не указан — дата документа), просроченное — в первом месяце; позже первого месяца по сроку —{" "}
          {formatMoney(dueLater(opening.openingReceivableDue))} дебиторки и {formatMoney(dueLater(opening.openingPayableDue))}{" "}
          кредиторки.
        </p>
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
              {newServiceInputs.map((service) => (
                <ProjectionRow
                  key={`c-${service.id}`}
                  label={`в т.ч. вклад «${service.name}» (выручка − переменные − ФОТ − постоянные)`}
                  values={projection.map((p) => p.newServices.find((x) => x.id === service.id)?.contribution ?? null)}
                  format="money"
                />
              ))}
              <ProjectionRow label="Точка безубыточности" values={projection.map((p) => p.breakEvenRevenue)} format="money" />
              <ProjectionRow label="Запас прочности, %" values={projection.map((p) => p.marginOfSafetyPct)} format="pct" />
              {loanInputs.length > 0 ? (
                <ProjectionRow label="Проценты по кредитам" values={projection.map((p) => p.loanInterest)} format="money" />
              ) : null}
              {taxOn ? (
                <>
                  <ProjectionRow label="Прибыль до налога" values={projection.map((p) => p.profitBeforeTax)} format="money" bold />
                  {tax.regime !== "none" ? (
                    <ProjectionRow label={`${TAX_REGIME_LABELS[tax.regime]} — начислено`} values={projection.map((p) => p.tax)} format="money" />
                  ) : null}
                  {tax.reduction ? (
                    <ProjectionRow label="в т.ч. уменьшение налога на страховые взносы" values={projection.map((p) => p.taxReduction)} format="money" />
                  ) : null}
                  {hasContribution ? (
                    <ProjectionRow label="Взносы ИП за себя — начислено" values={projection.map((p) => p.ipContribution)} format="money" />
                  ) : null}
                  <ProjectionRow label="Чистая прибыль" values={projection.map((p) => p.netProfit)} format="money" bold />
                </>
              ) : loanInputs.length > 0 ? (
                <ProjectionRow label="Прибыль после процентов" values={projection.map((p) => p.netProfit)} format="money" bold />
              ) : null}
              <ProjectionRow label="Поступления от клиентов" values={projection.map((p) => p.collections)} format="money" />
              <ProjectionRow
                label="Погашение текущей дебиторки"
                values={projection.map((p) => p.openingReceivableCollected)}
                format="money"
              />
              <ProjectionRow
                label="Оплаты поставщикам (переменные расходы и комиссия)"
                values={projection.map((p) => p.supplierPayments)}
                format="money"
              />
              <ProjectionRow label="Оплата текущей кредиторки и зарплаты" values={projection.map((p) => p.openingPayablePaid)} format="money" />
              {loanInputs.length > 0 ? (
                <>
                  <ProjectionRow label="Получение кредитов" values={projection.map((p) => p.loanDrawdown)} format="money" />
                  <ProjectionRow label="Погашение основного долга" values={projection.map((p) => p.loanPrincipal)} format="money" />
                </>
              ) : null}
              <ProjectionRow label="Прочие платежи по кредитам/лизингу" values={projection.map((p) => p.manualLoanPayments)} format="money" />
              {tax.regime !== "none" ? <ProjectionRow label="Уплата налога" values={projection.map((p) => p.taxPaid)} format="money" /> : null}
              {tax.vat ? (
                <>
                  <ProjectionRow label="НДС, полученный от клиентов" values={projection.map((p) => p.vatReceived)} format="money" />
                  <ProjectionRow label="НДС, уплаченный поставщикам" values={projection.map((p) => p.vatPaidToSuppliers)} format="money" />
                  <ProjectionRow label="НДС к уплате — начислено" values={projection.map((p) => p.vatAccrued)} format="money" />
                  <ProjectionRow label="Уплата НДС" values={projection.map((p) => p.vatPaid)} format="money" />
                </>
              ) : null}
              {hasContribution ? (
                <ProjectionRow label="Уплата взносов ИП за себя" values={projection.map((p) => p.ipContributionPaid)} format="money" />
              ) : null}
              <ProjectionRow label="Остаток денег" values={projection.map((p) => p.cashBalance)} format="money" bold />
              <ProjectionRow label="Дебиторка на конец месяца" values={projection.map((p) => p.receivableEnd)} format="money" />
              <ProjectionRow label="Кредиторка на конец месяца" values={projection.map((p) => p.payableEnd)} format="money" />
              {loanInputs.length > 0 ? (
                <ProjectionRow label="Долг по кредитам на конец месяца" values={projection.map((p) => p.loanDebt)} format="money" />
              ) : null}
              {tax.regime !== "none" ? (
                <ProjectionRow label="Налог к уплате на конец месяца" values={projection.map((p) => p.taxPayableEnd)} format="money" />
              ) : null}
              {tax.vat ? (
                <ProjectionRow label="НДС к уплате на конец месяца" values={projection.map((p) => p.vatPayableEnd)} format="money" />
              ) : null}
              {hasContribution ? (
                <ProjectionRow label="Взносы ИП к уплате на конец месяца" values={projection.map((p) => p.ipContributionPayableEnd)} format="money" />
              ) : null}
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
