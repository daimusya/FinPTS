"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { parseIntermediaryListDocx } from "@/lib/intermediaries/docx-list";
import { isInternalPath } from "@/lib/internal-path";
import { getAccessScope } from "@/lib/access-scope";
import { buildCommissionMonth, rateOn } from "@/lib/intermediaries/commissions";
import { parseDateParam } from "@/lib/date-param";
import Decimal from "decimal.js";
import { SCALE_SETTING_KEY, serializeScale, validateScale } from "@/lib/intermediaries/standard-scale";
import { loadStandardScale } from "@/lib/intermediaries/load";
import { loadCommissionContext, loadInflows, monthParam, parseMonthParam } from "@/lib/intermediaries/load";

const MAX_DOCX_BYTES = 4 * 1024 * 1024;

function refresh() {
  revalidatePath("/intermediaries", "layout");
  revalidatePath("/master-data/intermediaries");
}

/** Куда вернуться после действия — только внутренний адрес раздела. */
function backTo(formData: FormData, fallback = "/intermediaries"): string {
  const target = String(formData.get("returnTo") ?? "");
  return isInternalPath(target) && target.startsWith("/intermediaries") ? target : fallback;
}

function parsePct(value: FormDataEntryValue | null): number | null | "invalid" {
  const text = String(value ?? "").trim().replace(",", ".").replace("%", "");
  if (!text) return null;
  const pct = Number(text);
  return Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : "invalid";
}

export interface ListImportState {
  message?: string;
  error?: string;
}

/**
 * Список посредников из Word: новые посредники заводятся с процентом и
 * организациями, у существующих добавляются недостающие организации, а
 * процент обновляется, если в документе он указан. Ничего не удаляется.
 * Если ставку посредника уже меняли с даты, документ её не трогает: с какого
 * дня действует новый процент, знает только человек — он вносит его в карточке.
 */
export async function importIntermediaryListAction(_prev: ListImportState, formData: FormData): Promise<ListImportState> {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Выберите файл .docx со списком посредников" };
  if (file.size > MAX_DOCX_BYTES) return { error: "Файл слишком большой (максимум 4 МБ)" };

  let entries;
  try {
    entries = parseIntermediaryListDocx(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { error: "Не удалось прочитать документ — нужен файл Word (.docx) с таблицей «Посредник | Список организаций»" };
  }
  if (entries.length === 0) return { error: "В документе не найдена таблица посредников" };

  let created = 0;
  let clientsAdded = 0;
  const rateDiffers: string[] = [];
  for (const entry of entries) {
    const existing = await prisma.intermediary.findUnique({
      where: { name: entry.name },
      include: { clients: { select: { name: true } }, rates: { select: { validFrom: true, commissionPct: true }, orderBy: { validFrom: "asc" } } },
    });
    if (!existing) {
      const intermediary = await prisma.intermediary.create({
        data: {
          name: entry.name,
          // A rate written in the document is a negotiated one; without it the standard scale applies.
          category: entry.commissionPct === null ? "STANDARD" : "VIP",
          commissionPct: entry.commissionPct,
          clients: { create: entry.clients.map((name) => ({ name })) },
        },
      });
      created += 1;
      clientsAdded += entry.clients.length;
      await logAudit({ userId: session.userId, entityType: "intermediary", entityId: intermediary.id, action: "create", after: { name: entry.name, commissionPct: entry.commissionPct, clients: entry.clients.length } });
      continue;
    }
    const known = new Set(existing.clients.map((c) => c.name));
    const missing = entry.clients.filter((name) => !known.has(name));
    const dated = existing.rates.length > 0;
    if (dated && entry.commissionPct !== null) {
      const current = rateOn(
        {
          commissionPct: existing.commissionPct === null ? null : new Decimal(existing.commissionPct.toString()),
          rateChanges: existing.rates.map((r) => ({ from: r.validFrom, pct: new Decimal(r.commissionPct.toString()) })),
        },
        new Date(),
      );
      if (!current || !current.equals(entry.commissionPct)) rateDiffers.push(`${entry.name} (${entry.commissionPct}%)`);
    }
    await prisma.intermediary.update({
      where: { id: existing.id },
      data: {
        ...(entry.commissionPct !== null && !dated ? { commissionPct: entry.commissionPct } : {}),
        isArchived: false,
        clients: { create: missing.map((name) => ({ name })) },
      },
    });
    clientsAdded += missing.length;
    await logAudit({ userId: session.userId, entityType: "intermediary", entityId: existing.id, action: "update", after: { commissionPct: entry.commissionPct, clientsAdded: missing.length, source: file.name } });
  }
  refresh();
  const noPct = entries.filter((e) => e.commissionPct === null).map((e) => e.name);
  // Without a rate a new intermediary is «Стандарт» and has its scale — nothing to report.
  const standardNew = new Set((await prisma.intermediary.findMany({ where: { name: { in: noPct }, category: "STANDARD" }, select: { name: true } })).map((m) => m.name));
  noPct.splice(0, noPct.length, ...noPct.filter((name) => !standardNew.has(name)));
  return {
    message:
      `Посредников в документе: ${entries.length}, новых: ${created}; организаций добавлено: ${clientsAdded}.` +
      (noPct.length ? ` Без процента комиссии: ${noPct.join(", ")} — укажите его в настройках посредника.` : "") +
      (rateDiffers.length
        ? ` Ставка в документе отличается от действующей: ${rateDiffers.join(", ")} — у них ставку уже меняли с даты, поэтому новую внесите в карточке посредника с нужного дня.`
        : ""),
  };
}

/**
 * Закрепить ИНН плательщика: за посредником (intermediaryId) или «без
 * посредника» (none) — плательщик больше не попадает ни в один отчёт.
 * Пустое значение снимает закрепление, и снова действует поиск по названию.
 */
export async function bindPayerAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const inn = String(formData.get("inn") ?? "").trim();
  const payerName = String(formData.get("payerName") ?? "").trim() || null;
  const target = String(formData.get("intermediaryId") ?? "");
  const back = backTo(formData);
  if (!/^\d{10}(\d{2})?$/.test(inn)) redirect(back);

  const before = await prisma.intermediaryPayer.findUnique({ where: { inn } });
  if (target === "") {
    await prisma.intermediaryPayer.deleteMany({ where: { inn } });
  } else {
    const intermediaryId = target === "none" ? null : target;
    if (intermediaryId && !(await prisma.intermediary.findUnique({ where: { id: intermediaryId }, select: { id: true } }))) redirect(back);
    await prisma.intermediaryPayer.upsert({
      where: { inn },
      create: { inn, intermediaryId, payerName },
      update: { intermediaryId, payerName: payerName ?? undefined },
    });
  }
  await logAudit({
    userId: session.userId,
    entityType: "intermediary_payer",
    entityId: inn,
    action: target === "" ? "delete" : "update",
    before: before ? { intermediaryId: before.intermediaryId } : null,
    after: target === "" ? null : { intermediaryId: target === "none" ? null : target, payerName },
  });
  refresh();
  redirect(back);
}

/** «Всё верно»: закрепить ИНН всех найденных по названию плательщиков месяца за найденными посредниками. */
export async function confirmAllMatchesAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const ym = parseMonthParam(String(formData.get("month") ?? ""));
  const back = backTo(formData);
  if (!ym) redirect(back);
  const context = await loadCommissionContext();
  const inflows = await loadInflows(await getAccessScope(session), ym, ym);
  const { toReview } = buildCommissionMonth(context.intermediaries, context.bindings, inflows, context.ownInns);
  let bound = 0;
  for (const group of toReview) {
    if (!group.inn || group.match.kind !== "name") continue;
    await prisma.intermediaryPayer.upsert({
      where: { inn: group.inn },
      create: { inn: group.inn, intermediaryId: group.match.intermediaryId, payerName: group.name },
      update: {},
    });
    bound += 1;
  }
  await logAudit({ userId: session.userId, entityType: "intermediary_payer", entityId: monthParam(ym), action: "confirm_all", after: { bound } });
  refresh();
  redirect(back);
}

/** Плательщик без ИНН — его наименование добавляется в список организаций посредника. */
export async function addClientAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const intermediaryId = String(formData.get("intermediaryId") ?? "");
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  const back = backTo(formData, `/intermediaries/${intermediaryId}`);
  if (!intermediaryId || !name) redirect(back);
  const intermediary = await prisma.intermediary.findUnique({ where: { id: intermediaryId }, select: { id: true } });
  if (!intermediary) redirect("/intermediaries");
  const client = await prisma.intermediaryClient.upsert({
    where: { intermediaryId_name: { intermediaryId, name } },
    create: { intermediaryId, name },
    update: {},
  });
  await logAudit({ userId: session.userId, entityType: "intermediary_client", entityId: client.id, action: "create", after: { intermediaryId, name } });
  refresh();
  redirect(back);
}

export async function removeClientAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const id = String(formData.get("clientId") ?? "");
  const client = await prisma.intermediaryClient.findUnique({ where: { id } });
  if (client) {
    await prisma.intermediaryClient.delete({ where: { id } });
    await logAudit({ userId: session.userId, entityType: "intermediary_client", entityId: id, action: "delete", before: { intermediaryId: client.intermediaryId, name: client.name } });
  }
  refresh();
  redirect(backTo(formData, client ? `/intermediaries/${client.intermediaryId}` : "/intermediaries"));
}

export interface IntermediaryFormState {
  error?: string;
  saved?: boolean;
}

/** Новый посредник (id пуст) или изменение имени, подписи в отчёте, категории и ставки. */
export async function saveIntermediaryAction(_prev: IntermediaryFormState, formData: FormData): Promise<IntermediaryFormState> {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").replace(/\s+/g, " ").trim();
  const reportName = String(formData.get("reportName") ?? "").replace(/\s+/g, " ").trim() || null;
  const category = formData.get("category") === "STANDARD" ? "STANDARD" : "VIP";
  const turnoverText = String(formData.get("turnoverFrom") ?? "").trim();
  const turnoverFrom = category === "STANDARD" && turnoverText ? parseDateParam(turnoverText) : null;
  const pct = parsePct(formData.get("commissionPct"));
  if (!name) return { error: "Укажите посредника" };
  if (pct === "invalid") return { error: "Комиссия — число от 0 до 100" };
  if (category === "STANDARD" && turnoverText && !turnoverFrom) return { error: "Дата начала оборота указана неверно" };

  const clash = await prisma.intermediary.findFirst({ where: { name, NOT: id ? { id } : undefined }, select: { id: true } });
  if (clash) return { error: "Посредник с таким именем уже есть" };

  if (!id) {
    const created = await prisma.intermediary.create({ data: { name, reportName, category, turnoverFrom, commissionPct: pct } });
    await logAudit({
      userId: session.userId,
      entityType: "intermediary",
      entityId: created.id,
      action: "create",
      after: { name, reportName, category, turnoverFrom: turnoverText || null, commissionPct: pct },
    });
    refresh();
    redirect(`/intermediaries/${created.id}`);
  }
  const before = await prisma.intermediary.findUnique({ where: { id } });
  if (!before) return { error: "Посредник не найден" };
  // The negotiated rate stays stored for «Стандарт» too: switching back to VIP restores it.
  await prisma.intermediary.update({
    where: { id },
    data: { name, reportName, category, turnoverFrom, ...(category === "VIP" ? { commissionPct: pct } : {}) },
  });
  await logAudit({
    userId: session.userId,
    entityType: "intermediary",
    entityId: id,
    action: "update",
    before: {
      name: before.name,
      reportName: before.reportName,
      category: before.category,
      turnoverFrom: before.turnoverFrom?.toISOString().slice(0, 10) ?? null,
      commissionPct: before.commissionPct?.toString() ?? null,
    },
    after: { name, reportName, category, turnoverFrom: turnoverText || null, ...(category === "VIP" ? { commissionPct: pct } : {}) },
  });
  refresh();
  return { saved: true };
}

export async function archiveIntermediaryAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const id = String(formData.get("id") ?? "");
  const archive = formData.get("archive") === "1";
  const found = await prisma.intermediary.findUnique({ where: { id }, select: { id: true } });
  if (found) {
    await prisma.intermediary.update({ where: { id }, data: { isArchived: archive } });
    await logAudit({ userId: session.userId, entityType: "intermediary", entityId: id, action: archive ? "archive" : "restore" });
  }
  refresh();
  redirect(archive ? "/intermediaries" : `/intermediaries/${id}`);
}

/**
 * Новая ставка с даты: действует для поступлений с этого дня до следующего
 * изменения. На ту же дату — заменяет прежнюю запись.
 */
export async function addRateChangeAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const intermediaryId = String(formData.get("intermediaryId") ?? "");
  const back = `/intermediaries/${intermediaryId}`;
  const fail = (message: string): never => redirect(`${back}?rateError=${encodeURIComponent(message)}#rates`);
  const intermediary = await prisma.intermediary.findUnique({ where: { id: intermediaryId }, select: { id: true } });
  if (!intermediary) redirect("/intermediaries");
  const validFrom = parseDateParam(String(formData.get("validFrom") ?? ""));
  const pct = parsePct(formData.get("commissionPct"));
  if (!validFrom) fail("Укажите дату, с которой действует ставка");
  if (pct === null || pct === "invalid") fail("Ставка — число от 0 до 100");

  const before = await prisma.intermediaryRate.findUnique({ where: { intermediaryId_validFrom: { intermediaryId, validFrom: validFrom! } } });
  const rate = await prisma.intermediaryRate.upsert({
    where: { intermediaryId_validFrom: { intermediaryId, validFrom: validFrom! } },
    create: { intermediaryId, validFrom: validFrom!, commissionPct: pct as number },
    update: { commissionPct: pct as number },
  });
  await logAudit({
    userId: session.userId,
    entityType: "intermediary_rate",
    entityId: rate.id,
    action: before ? "update" : "create",
    before: before ? { validFrom: before.validFrom.toISOString().slice(0, 10), commissionPct: before.commissionPct.toString() } : null,
    after: { intermediaryId, validFrom: validFrom!.toISOString().slice(0, 10), commissionPct: pct },
  });
  refresh();
  redirect(`${back}#rates`);
}

/** Удалить изменение ставки (внесено по ошибке): поступления с той даты снова считаются по предыдущей ставке. */
export async function removeRateChangeAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const id = String(formData.get("rateId") ?? "");
  const rate = await prisma.intermediaryRate.findUnique({ where: { id } });
  if (!rate) redirect("/intermediaries");
  await prisma.intermediaryRate.delete({ where: { id } });
  await logAudit({
    userId: session.userId,
    entityType: "intermediary_rate",
    entityId: id,
    action: "delete",
    before: { intermediaryId: rate!.intermediaryId, validFrom: rate!.validFrom.toISOString().slice(0, 10), commissionPct: rate!.commissionPct.toString() },
  });
  refresh();
  redirect(`/intermediaries/${rate!.intermediaryId}#rates`);
}

export interface ScaleFormState {
  error?: string;
  saved?: boolean;
}

/** Шкала «Стандарта» — общая для всех посредников этой категории. */
export async function saveStandardScaleAction(_prev: ScaleFormState, formData: FormData): Promise<ScaleFormState> {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const rows: Array<{ upTo: string; pct: string }> = [];
  for (let i = 0; formData.has(`pct_${i}`); i++) rows.push({ upTo: String(formData.get(`upTo_${i}`) ?? ""), pct: String(formData.get(`pct_${i}`) ?? "") });
  const result = validateScale(rows);
  if ("error" in result) return { error: result.error };
  const before = await loadStandardScale();
  const value = serializeScale(result.scale);
  await prisma.appSetting.upsert({ where: { key: SCALE_SETTING_KEY }, create: { key: SCALE_SETTING_KEY, value }, update: { value } });
  await logAudit({
    userId: session.userId,
    entityType: "app_setting",
    entityId: SCALE_SETTING_KEY,
    action: "update",
    before: JSON.parse(serializeScale(before)),
    after: JSON.parse(value),
  });
  refresh();
  return { saved: true };
}
