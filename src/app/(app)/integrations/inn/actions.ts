"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { INN_PROFILE_SYSTEM, lookupRequisitesByInn } from "@/lib/integrations/inn-service";
import { validateInn } from "@/lib/integrations/inn";

export async function saveInnLookupSettingsAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);

  const newKey = String(formData.get("apiKey") ?? "").trim();
  const isEnabled = formData.get("isEnabled") === "on";
  const existing = await prisma.integrationProfile.findFirst({ where: { system: INN_PROFILE_SYSTEM } });
  // Empty field = keep the stored key (the form only shows a mask, never the key itself).
  const apiKeyEnc = newKey ? encryptSecret(newKey) : (existing?.config as { apiKeyEnc?: string } | null)?.apiKeyEnc;
  if (isEnabled && !apiKeyEnc) redirect(`/integrations/inn?error=${encodeURIComponent("Укажите ключ API перед включением")}`);

  const profile = existing
    ? await prisma.integrationProfile.update({ where: { id: existing.id }, data: { isEnabled, config: { apiKeyEnc } } })
    : await prisma.integrationProfile.create({
        data: { system: INN_PROFILE_SYSTEM, name: "DaData — реквизиты по ИНН", isEnabled, config: { apiKeyEnc } },
      });

  await logAudit({
    userId: session.userId,
    entityType: "integration_profile",
    entityId: profile.id,
    action: "update",
    after: { system: INN_PROFILE_SYSTEM, isEnabled, hasKey: Boolean(apiKeyEnc), keyChanged: Boolean(newKey) } as never,
  });

  revalidatePath("/integrations/inn");
  redirect("/integrations/inn?saved=1");
}

const REQUISITE_FIELDS = ["fullName", "shortName", "kpp", "ogrn", "legalAddress", "director", "status"] as const;

/** Создаёт контрагента по ИНН (или открывает существующего с этим ИНН). */
export async function createCounterpartyByInnAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const back = (message: string): never => redirect(`/master-data/counterparties?innError=${encodeURIComponent(message)}`);

  const inn = String(formData.get("inn") ?? "").replace(/\s/g, "");
  const invalid = validateInn(inn);
  if (invalid) back(invalid);

  const existing = await prisma.counterparty.findFirst({ where: { inn } });
  if (existing) redirect(`/master-data/counterparties/${existing.id}/edit?notice=${encodeURIComponent("Контрагент с этим ИНН уже есть")}`);

  const result = await lookupRequisitesByInn(inn);
  if (!result.found) back(result.error);
  const r = (result as Extract<typeof result, { found: true }>).requisites;

  const created = await prisma.counterparty.create({
    data: {
      inn: r.inn,
      fullName: r.fullName,
      shortName: r.shortName,
      kpp: r.kpp,
      ogrn: r.ogrn,
      legalAddress: r.legalAddress,
      director: r.director,
      status: r.status,
      dataSource: "DADATA",
      dataUpdatedAt: new Date(),
    },
  });
  await logAudit({
    userId: session.userId,
    entityType: "counterparty",
    entityId: created.id,
    action: "create_by_inn",
    after: created as never,
  });

  revalidatePath("/master-data/counterparties");
  redirect(`/master-data/counterparties/${created.id}/edit?notice=${encodeURIComponent("Реквизиты заполнены по ИНН из ЕГРЮЛ/ЕГРИП")}`);
}

/** Обновляет реквизиты существующего контрагента по его ИНН. Фактический адрес и флаги не трогает. */
export async function refreshCounterpartyByInnAction(id: string) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const back = (param: "error" | "notice", message: string): never =>
    redirect(`/master-data/counterparties/${id}/edit?${param}=${encodeURIComponent(message)}`);

  const before = await prisma.counterparty.findUniqueOrThrow({ where: { id } });
  if (!before.inn) back("error", "У контрагента не указан ИНН");
  const result = await lookupRequisitesByInn(before.inn!);
  if (!result.found) back("error", result.error);
  const r = (result as Extract<typeof result, { found: true }>).requisites;

  const changed = REQUISITE_FIELDS.filter((f) => (before[f] ?? null) !== (r[f] ?? null));
  const updated = await prisma.counterparty.update({
    where: { id },
    data: {
      fullName: r.fullName,
      shortName: r.shortName,
      kpp: r.kpp,
      ogrn: r.ogrn,
      legalAddress: r.legalAddress,
      director: r.director,
      status: r.status,
      dataSource: "DADATA",
      dataUpdatedAt: new Date(),
    },
  });
  await logAudit({
    userId: session.userId,
    entityType: "counterparty",
    entityId: id,
    action: "refresh_by_inn",
    before: before as never,
    after: updated as never,
  });

  revalidatePath(`/master-data/counterparties/${id}/edit`);
  back("notice", changed.length > 0 ? `Реквизиты обновлены по ИНН (изменено полей: ${changed.length})` : "Реквизиты актуальны — изменений нет");
}
