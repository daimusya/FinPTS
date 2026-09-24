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
}

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
    },
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
    });
  }
  return byScenario;
}
