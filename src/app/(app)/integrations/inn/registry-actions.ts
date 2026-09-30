"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { hasPermission, requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { validateInn } from "@/lib/integrations/inn";
import {
  changedRegistryFields,
  counterpartyDataFromRegistry,
  ensureCounterpartyByInn,
  lookupRequisitesByInn,
  needsRegistryData,
  organizationDataFromRegistry,
} from "@/lib/integrations/inn-service";
import { ORGANIZATION_REGISTRY_LABELS } from "@/lib/integrations/inn-labels";

/** Сколько ИНН или записей обрабатывать за одно нажатие: запросы к реестру идут по одному. */
const BATCH = 50;

const safeReturn = (raw: unknown, fallback: string) => {
  const path = String(raw ?? "");
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
};
const withParam = (path: string, key: string, value: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

/**
 * Операции банка и кассы с ИНН, но без контрагента: для каждого ИНН —
 * существующий контрагент или новый из ЕГРЮЛ/ЕГРИП, и операции с этим ИНН
 * привязываются к нему. Операции закрытых периодов и переводы между своими
 * счетами не меняются; ИНН, которых нет в реестре (физлица), пропускаются.
 */
export async function createCounterpartiesFromOperationsAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const back = safeReturn(formData.get("returnTo"), "/cash/transactions");
  if (!hasPermission(session, PERMISSIONS.MASTERDATA_MANAGE)) redirect(withParam(back, "error", "Создавать контрагентов может тот, кто ведёт справочники"));

  const groups = await prisma.bankTransaction.groupBy({
    by: ["counterpartyInn"],
    where: { counterpartyId: null, isTransfer: false, counterpartyInn: { not: null } },
    _count: true,
    orderBy: { _count: { counterpartyInn: "desc" } },
    take: BATCH,
  });
  const closed = await prisma.accountingPeriod.findMany({ where: { status: "CLOSED" }, select: { year: true, month: true } });
  const closedKeys = new Set(closed.map((p) => `${p.year}-${p.month}`));
  const inClosed = (d: Date) => closedKeys.has(`${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`);

  let created = 0;
  let linkedCounterparties = 0;
  let linkedOperations = 0;
  let skippedClosed = 0;
  const notFound: string[] = [];
  for (const g of groups) {
    const inn = g.counterpartyInn!;
    if (validateInn(inn)) {
      notFound.push(inn);
      continue;
    }
    const outcome = await ensureCounterpartyByInn(inn);
    if ("error" in outcome) {
      notFound.push(inn);
      // A wrong key or an exhausted limit is the same for every INN — stop and say so.
      if (/ключ|лимит|недоступен|не настроен/i.test(outcome.error)) redirect(withParam(back, "error", outcome.error));
      continue;
    }
    if (outcome.created) {
      created += 1;
      await logAudit({ userId: session.userId, entityType: "counterparty", entityId: outcome.id, action: "create_by_inn_from_operations", after: { inn } as never });
    }
    const operations = await prisma.bankTransaction.findMany({
      where: { counterpartyInn: inn, counterpartyId: null, isTransfer: false },
      select: { id: true, operationDate: true },
    });
    const open = operations.filter((o) => !inClosed(o.operationDate));
    skippedClosed += operations.length - open.length;
    if (open.length === 0) continue;
    await prisma.bankTransaction.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { counterpartyId: outcome.id } });
    linkedCounterparties += 1;
    linkedOperations += open.length;
    await logAudit({
      userId: session.userId,
      entityType: "bank_transaction",
      entityId: "bulk",
      action: "link_counterparty_by_inn",
      after: { counterpartyId: outcome.id, inn, transactionIds: open.map((o) => o.id) } as never,
    });
  }

  revalidatePath("/cash/transactions");
  revalidatePath("/master-data/counterparties");
  const parts = [`создано контрагентов ${created}`, `привязано операций ${linkedOperations} (контрагентов ${linkedCounterparties})`];
  if (skippedClosed) parts.push(`не тронуто в закрытых периодах ${skippedClosed}`);
  if (notFound.length) parts.push(`нет в реестре: ${notFound.slice(0, 5).join(", ")}${notFound.length > 5 ? ` и ещё ${notFound.length - 5}` : ""}`);
  redirect(withParam(back, "notice", `Контрагенты по ИНН: ${parts.join("; ")}.`));
}

/**
 * Дополнить из реестра контрагентов, у которых реквизитов реестра нет: заведены
 * загрузкой из 1С или вручную одним наименованием с ИНН. Введённое руками
 * (КПП, ОГРН или адрес уже есть) не затирается.
 */
export async function enrichCounterpartiesAction() {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const back = (param: "importResult" | "innError", message: string): never =>
    redirect(`/master-data/counterparties?${param}=${encodeURIComponent(message)}`);

  const candidates = (
    await prisma.counterparty.findMany({
      where: { isArchived: false, inn: { not: null }, OR: [{ dataSource: null }, { dataSource: { not: "DADATA" } }] },
      orderBy: { createdAt: "asc" },
    })
  ).filter(needsRegistryData);
  if (candidates.length === 0) back("importResult", "Дополнять нечего: у всех контрагентов с ИНН реквизиты уже из реестра или введены вручную.");

  let updated = 0;
  const failed: string[] = [];
  for (const c of candidates.slice(0, BATCH)) {
    const result = await lookupRequisitesByInn(c.inn!);
    if (!result.found) {
      if (/ключ|лимит|недоступен|не настроен/i.test(result.error)) back("innError", result.error);
      failed.push(`${c.shortName || c.fullName} (${c.inn})`);
      continue;
    }
    const after = await prisma.counterparty.update({ where: { id: c.id }, data: counterpartyDataFromRegistry(result.requisites) });
    await logAudit({ userId: session.userId, entityType: "counterparty", entityId: c.id, action: "refresh_by_inn", before: c as never, after: after as never });
    updated += 1;
  }
  revalidatePath("/master-data/counterparties");
  const rest = candidates.length - Math.min(candidates.length, BATCH);
  back(
    "importResult",
    `Реквизиты дополнены по ИНН: ${updated}${failed.length ? `; не найдены в реестре: ${failed.slice(0, 5).join(", ")}${failed.length > 5 ? ` и ещё ${failed.length - 5}` : ""}` : ""}${rest > 0 ? `; осталось ${rest} — нажмите ещё раз` : ""}.`,
  );
}

/** Организация по ИНН: новая с реквизитами реестра (или открыть существующую с этим ИНН). */
export async function createOrganizationByInnAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const back = (message: string): never => redirect(`/master-data/organizations?innError=${encodeURIComponent(message)}`);
  const inn = String(formData.get("inn") ?? "").replace(/\s/g, "");
  const invalid = validateInn(inn);
  if (invalid) back(invalid);
  const existing = await prisma.organization.findFirst({ where: { inn } });
  if (existing) redirect(`/master-data/organizations/${existing.id}/edit?notice=${encodeURIComponent("Организация с этим ИНН уже есть — открыта она")}`);

  const result = await lookupRequisitesByInn(inn);
  if (!result.found) back(result.error);
  const r = (result as Extract<typeof result, { found: true }>).requisites;
  // A sole proprietor defaults to the simplified tax system, a company to the general one — the card lets you change it.
  const created = await prisma.organization.create({
    data: { inn: r.inn, taxSystem: r.type === "SOLE_PROPRIETOR" ? "usn_income" : "osn", ...organizationDataFromRegistry(r) },
  });
  await logAudit({ userId: session.userId, entityType: "organization", entityId: created.id, action: "create_by_inn", after: created as never });
  revalidatePath("/master-data/organizations");
  redirect(
    `/master-data/organizations/${created.id}/edit?notice=${encodeURIComponent("Реквизиты заполнены по ИНН из ЕГРЮЛ/ЕГРИП — проверьте систему налогообложения")}`,
  );
}

/** Обновить реквизиты организации по её ИНН: наименование, КПП, ОГРН, адрес, тип, даты регистрации и прекращения. */
export async function refreshOrganizationByInnAction(id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const back = (param: "error" | "notice", message: string): never =>
    redirect(`/master-data/organizations/${id}/edit?${param}=${encodeURIComponent(message)}`);
  const before = await prisma.organization.findUniqueOrThrow({ where: { id } });
  if (!before.inn) back("error", "У организации не указан ИНН");
  const result = await lookupRequisitesByInn(before.inn!);
  if (!result.found) back("error", result.error);
  const data = organizationDataFromRegistry((result as Extract<typeof result, { found: true }>).requisites);
  const changed = changedRegistryFields(before, data, ORGANIZATION_REGISTRY_LABELS);
  const after = await prisma.organization.update({ where: { id }, data });
  await logAudit({ userId: session.userId, entityType: "organization", entityId: id, action: "refresh_by_inn", before: before as never, after: after as never });
  revalidatePath(`/master-data/organizations/${id}/edit`);
  revalidatePath("/master-data/organizations");
  back("notice", changed.length > 0 ? `Реквизиты обновлены по ИНН: ${changed.join(", ")}` : "Реквизиты актуальны — изменений нет");
}
