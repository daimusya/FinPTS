import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import type { NewServiceInput } from "./project";

export const MAX_RAMP_UP_MONTHS = 36;

export interface NewServiceFormData {
  name: string;
  productServiceId: string | null;
  launchYear: number;
  launchMonth: number;
  avgCheck: Decimal;
  salesPerMonth: Decimal;
  rampUpMonths: number;
  variableCostPct: Decimal | null;
  staffHeadcount: number | null;
  staffCostPerEmployee: Decimal | null;
  monthlyFixedCosts: Decimal | null;
  launchCosts: Decimal | null;
}

/** Поля формы новой услуги — общие для добавления и правки. */
export const NEW_SERVICE_FIELDS = [
  "name",
  "productServiceId",
  "launch",
  "avgCheck",
  "salesPerMonth",
  "rampUpMonths",
  "variableCostPct",
  "staffHeadcount",
  "staffCostPerEmployee",
  "monthlyFixedCosts",
  "launchCosts",
] as const;

function parseAmount(raw: string): Decimal | null {
  const cleaned = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "" || !/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return new Decimal(cleaned);
}

/**
 * Проверяет форму новой услуги. Название можно не вводить, если выбрана
 * услуга из справочника, — тогда берётся её название (productName).
 */
export function parseNewServiceForm(
  raw: Record<string, string>,
  productName: string | null,
): { data: NewServiceFormData } | { error: string } {
  const name = (raw.name ?? "").trim() || productName || "";
  if (!name) return { error: "Укажите название услуги или выберите её из справочника" };

  const launch = (raw.launch ?? "").match(/^(\d{4})-(\d{2})$/);
  const launchMonth = launch ? Number(launch[2]) : 0;
  if (!launch || launchMonth < 1 || launchMonth > 12) return { error: "Укажите месяц запуска" };

  const avgCheck = parseAmount(raw.avgCheck ?? "");
  if (!avgCheck || avgCheck.lessThanOrEqualTo(0)) return { error: "Средний чек — положительное число" };
  const salesPerMonth = parseAmount(raw.salesPerMonth ?? "");
  if (!salesPerMonth || salesPerMonth.lessThanOrEqualTo(0)) return { error: "Продажи в месяц — положительное число" };

  const rampRaw = (raw.rampUpMonths ?? "").trim();
  const rampUpMonths = rampRaw === "" ? 0 : Number(rampRaw);
  if (!Number.isInteger(rampUpMonths) || rampUpMonths < 0 || rampUpMonths > MAX_RAMP_UP_MONTHS) {
    return { error: `Выход на полную мощность — целое число месяцев от 0 до ${MAX_RAMP_UP_MONTHS}` };
  }

  const pctRaw = (raw.variableCostPct ?? "").trim();
  let variableCostPct: Decimal | null = null;
  if (pctRaw !== "") {
    variableCostPct = parseAmount(pctRaw);
    if (!variableCostPct || variableCostPct.greaterThan(100)) return { error: "Переменные расходы услуги — от 0 до 100%" };
  }

  const staffRaw = (raw.staffHeadcount ?? "").trim();
  const staffHeadcount = staffRaw === "" ? null : Number(staffRaw);
  if (staffHeadcount !== null && (!Number.isInteger(staffHeadcount) || staffHeadcount < 0 || staffHeadcount > 10000)) {
    return { error: "Персонал под услугу — целое число человек" };
  }
  const optionalAmount = (key: string, label: string): Decimal | null | { error: string } => {
    const value = (raw[key] ?? "").trim();
    if (value === "") return null;
    const amount = parseAmount(value);
    return amount ? amount : { error: `${label} — неотрицательная сумма` };
  };
  const staffCost = optionalAmount("staffCostPerEmployee", "Стоимость сотрудника");
  const monthlyFixed = optionalAmount("monthlyFixedCosts", "Постоянные расходы услуги");
  const launchCosts = optionalAmount("launchCosts", "Расходы на запуск");
  for (const v of [staffCost, monthlyFixed, launchCosts]) if (v && "error" in v) return v;

  return {
    data: {
      name,
      productServiceId: raw.productServiceId || null,
      launchYear: Number(launch[1]),
      launchMonth,
      avgCheck,
      salesPerMonth,
      rampUpMonths,
      variableCostPct,
      staffHeadcount: staffHeadcount || null,
      staffCostPerEmployee: staffCost as Decimal | null,
      monthlyFixedCosts: monthlyFixed as Decimal | null,
      launchCosts: launchCosts as Decimal | null,
    },
  };
}

/** Данные новой услуги для записи в БД (суммы — строками с копейками). */
export function newServiceDbData(data: NewServiceFormData) {
  const money = (d: Decimal | null) => (d === null ? null : d.toFixed(2));
  return {
    name: data.name,
    productServiceId: data.productServiceId,
    launchYear: data.launchYear,
    launchMonth: data.launchMonth,
    avgCheck: data.avgCheck.toFixed(2),
    salesPerMonth: data.salesPerMonth.toFixed(2),
    rampUpMonths: data.rampUpMonths,
    variableCostPct: money(data.variableCostPct),
    staffHeadcount: data.staffHeadcount,
    staffCostPerEmployee: money(data.staffCostPerEmployee),
    monthlyFixedCosts: money(data.monthlyFixedCosts),
    launchCosts: money(data.launchCosts),
  };
}

/** Новые услуги сценариев в виде входа для projectScenario, по id сценария. */
export async function loadNewServices(scenarioIds: string[]): Promise<Map<string, NewServiceInput[]>> {
  const rows = await prisma.financialScenarioNewService.findMany({
    where: { scenarioId: { in: scenarioIds } },
    orderBy: [{ launchYear: "asc" }, { launchMonth: "asc" }, { name: "asc" }],
  });
  const byScenario = new Map<string, NewServiceInput[]>(scenarioIds.map((id) => [id, []]));
  for (const r of rows) {
    byScenario.get(r.scenarioId)?.push({
      id: r.id,
      name: r.name,
      launchYear: r.launchYear,
      launchMonth: r.launchMonth,
      avgCheck: r.avgCheck.toString(),
      salesPerMonth: r.salesPerMonth.toString(),
      rampUpMonths: r.rampUpMonths,
      variableCostPct: r.variableCostPct === null ? null : r.variableCostPct.toString(),
      staffHeadcount: r.staffHeadcount,
      staffCostPerEmployee: r.staffCostPerEmployee?.toString() ?? null,
      monthlyFixedCosts: r.monthlyFixedCosts?.toString() ?? null,
      launchCosts: r.launchCosts?.toString() ?? null,
    });
  }
  return byScenario;
}
