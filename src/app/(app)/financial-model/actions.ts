"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { ALL_DRIVER_DEFS } from "@/lib/financial-model/drivers";
import { parseNewServiceForm, type NewServiceFormData } from "@/lib/financial-model/new-services";
import { materializeScenarioDepartments } from "@/lib/financial-model/scenario-departments";
import { parseLoanForm, type LoanFormData } from "@/lib/financial-model/loans";

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

function scenarioUrl(scenarioId: string, formData: FormData, extra = "") {
  const params = new URLSearchParams();
  for (const key of ["startYear", "startMonth"]) {
    const value = String(formData.get(key) ?? "");
    if (value) params.set(key, value);
  }
  if (extra) params.set("error", extra);
  const query = params.toString();
  return `/financial-model/${scenarioId}${query ? `?${query}` : ""}`;
}

export async function addNewServiceAction(scenarioId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const raw = Object.fromEntries(
    ["name", "productServiceId", "launch", "avgCheck", "salesPerMonth", "rampUpMonths", "variableCostPct"].map((k) => [
      k,
      String(formData.get(k) ?? ""),
    ]),
  );
  const product = raw.productServiceId
    ? await prisma.productService.findFirst({ where: { id: raw.productServiceId, isArchived: false } })
    : null;
  if (raw.productServiceId && !product) redirect(scenarioUrl(scenarioId, formData, "Услуга из справочника не найдена"));

  const parsed = parseNewServiceForm(raw, product?.name ?? null);
  if ("error" in parsed) redirect(scenarioUrl(scenarioId, formData, parsed.error));
  const { data } = parsed as { data: NewServiceFormData };

  const created = await prisma.financialScenarioNewService.create({
    data: {
      scenarioId,
      name: data.name,
      productServiceId: data.productServiceId,
      launchYear: data.launchYear,
      launchMonth: data.launchMonth,
      avgCheck: data.avgCheck.toFixed(2),
      salesPerMonth: data.salesPerMonth.toFixed(2),
      rampUpMonths: data.rampUpMonths,
      variableCostPct: data.variableCostPct?.toFixed(2) ?? null,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "financial_scenario",
    entityId: scenarioId,
    action: "add_new_service",
    after: created as never,
  });

  revalidatePath(`/financial-model/${scenarioId}`);
  redirect(scenarioUrl(scenarioId, formData));
}

export async function removeNewServiceAction(scenarioId: string, serviceId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const service = await prisma.financialScenarioNewService.findFirst({ where: { id: serviceId, scenarioId } });
  if (service) {
    await prisma.financialScenarioNewService.delete({ where: { id: serviceId } });
    await logAudit({
      userId: session.userId,
      entityType: "financial_scenario",
      entityId: scenarioId,
      action: "remove_new_service",
      before: service as never,
    });
  }

  revalidatePath(`/financial-model/${scenarioId}`);
  redirect(scenarioUrl(scenarioId, formData));
}

export async function addLoanAction(scenarioId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const raw = Object.fromEntries(
    ["name", "amount", "start", "annualRatePct", "termMonths", "repayment"].map((k) => [k, String(formData.get(k) ?? "")]),
  );
  const parsed = parseLoanForm(raw);
  if ("error" in parsed) redirect(scenarioUrl(scenarioId, formData, parsed.error));
  const { data } = parsed as { data: LoanFormData };

  const created = await prisma.financialScenarioLoan.create({
    data: {
      scenarioId,
      name: data.name,
      amount: data.amount.toFixed(2),
      startYear: data.startYear,
      startMonth: data.startMonth,
      annualRatePct: data.annualRatePct.toFixed(3),
      termMonths: data.termMonths,
      repayment: data.repayment,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "financial_scenario",
    entityId: scenarioId,
    action: "add_loan",
    after: created as never,
  });

  revalidatePath(`/financial-model/${scenarioId}`);
  redirect(scenarioUrl(scenarioId, formData));
}

export async function removeLoanAction(scenarioId: string, loanId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const loan = await prisma.financialScenarioLoan.findFirst({ where: { id: loanId, scenarioId } });
  if (loan) {
    await prisma.financialScenarioLoan.delete({ where: { id: loanId } });
    await logAudit({
      userId: session.userId,
      entityType: "financial_scenario",
      entityId: scenarioId,
      action: "remove_loan",
      before: loan as never,
    });
  }

  revalidatePath(`/financial-model/${scenarioId}`);
  redirect(scenarioUrl(scenarioId, formData));
}

export async function addScenarioDepartmentAction(scenarioId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  const departmentId = String(formData.get("departmentId") ?? "");
  const department = departmentId
    ? await prisma.department.findFirst({ where: { id: departmentId, isArchived: false } })
    : null;
  if (!department) redirect(scenarioUrl(scenarioId, formData, "Выберите подразделение"));

  await materializeScenarioDepartments(scenarioId);
  await prisma.financialScenarioDepartment.createMany({
    data: [{ scenarioId, departmentId: department!.id }],
    skipDuplicates: true,
  });

  await logAudit({
    userId: session.userId,
    entityType: "financial_scenario",
    entityId: scenarioId,
    action: "add_department",
    after: { departmentId: department!.id, name: department!.name } as never,
  });

  revalidatePath(`/financial-model/${scenarioId}`);
  redirect(scenarioUrl(scenarioId, formData));
}

/** Убирает подразделение из сценария вместе с его продажами и производительностью. */
export async function removeScenarioDepartmentAction(scenarioId: string, departmentId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.FINANCIAL_MODEL_MANAGE);

  await materializeScenarioDepartments(scenarioId);
  const [removedValues] = await prisma.$transaction([
    prisma.financialScenarioValue.deleteMany({ where: { scenarioId, dimension: departmentId } }),
    prisma.financialScenarioDepartment.deleteMany({ where: { scenarioId, departmentId } }),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "financial_scenario",
    entityId: scenarioId,
    action: "remove_department",
    before: { departmentId, removedValues: removedValues.count } as never,
  });

  revalidatePath(`/financial-model/${scenarioId}`);
  redirect(scenarioUrl(scenarioId, formData));
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
