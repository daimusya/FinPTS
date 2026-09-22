"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { ALL_DRIVER_DEFS } from "@/lib/financial-model/drivers";

export async function createScenarioAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "custom");

  if (!name) {
    redirect(`/financial-model/new?error=${encodeURIComponent("Укажите название сценария")}`);
  }

  const scenario = await prisma.financialScenario.create({ data: { name, type } });

  await logAudit({
    userId: session.userId,
    entityType: "financial_scenario",
    entityId: scenario.id,
    action: "create",
    after: scenario as never,
  });

  revalidatePath("/financial-model");
  redirect(`/financial-model/${scenario.id}`);
}

export async function archiveScenarioAction(id: string) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const updated = await prisma.financialScenario.update({ where: { id }, data: { isArchived: true } });

  await logAudit({
    userId: session.userId,
    entityType: "financial_scenario",
    entityId: id,
    action: "archive",
    after: updated as never,
  });

  revalidatePath("/financial-model");
}

/**
 * Сохраняет все значения драйверов сценария за один раз: форма редактора
 * присылает поля вида `v__<driver>__<year>_<month>` (и `v__<driver>__<dim>__<year>_<month>`
 * для подразделений). Пустое значение удаляет строку, а не сохраняет 0 —
 * так по умолчанию действуют формулы (100% для сезонности и т.д.), а не
 * искусственный ноль.
 */
export async function saveScenarioValuesAction(scenarioId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const driverCodes = new Set(ALL_DRIVER_DEFS.map((d) => d.code));
  const toUpsert: Array<{ year: number; month: number; driver: string; dimension: string; value: string }> = [];
  const toDelete: Array<{ year: number; month: number; driver: string; dimension: string }> = [];

  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("v__")) continue;
    const parts = key.split("__");
    // v__driver__year_month  OR  v__driver__dimension__year_month
    let driver: string;
    let dimension: string;
    let ym: string;
    if (parts.length === 3) {
      [, driver, ym] = parts;
      dimension = "";
    } else if (parts.length === 4) {
      [, driver, dimension, ym] = parts;
    } else {
      continue;
    }
    if (!driverCodes.has(driver as never)) continue;
    const [yearStr, monthStr] = ym.split("_");
    const year = Number(yearStr);
    const month = Number(monthStr);
    const value = String(rawValue).trim();

    if (!value) {
      toDelete.push({ year, month, driver, dimension });
    } else if (!Number.isNaN(Number(value))) {
      toUpsert.push({ year, month, driver, dimension, value });
    }
  }

  await prisma.$transaction([
    ...toUpsert.map((row) =>
      prisma.financialScenarioValue.upsert({
        where: {
          scenarioId_year_month_driver_dimension: {
            scenarioId,
            year: row.year,
            month: row.month,
            driver: row.driver,
            dimension: row.dimension,
          },
        },
        update: { value: row.value },
        create: { scenarioId, ...row },
      }),
    ),
    ...toDelete.map((row) =>
      prisma.financialScenarioValue.deleteMany({
        where: { scenarioId, year: row.year, month: row.month, driver: row.driver, dimension: row.dimension },
      }),
    ),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "financial_scenario",
    entityId: scenarioId,
    action: "update_values",
    after: { upserted: toUpsert.length, deleted: toDelete.length } as never,
  });

  revalidatePath(`/financial-model/${scenarioId}`);
}
