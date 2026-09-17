"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { sendOutboxEvent } from "@/lib/integrations/outbox";

export async function saveBitrix24ProfileAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);

  const webhookUrl = String(formData.get("webhookUrl") ?? "").trim();
  const isEnabled = formData.get("isEnabled") === "on";

  if (isEnabled && !webhookUrl) {
    throw new Error("Укажите адрес вебхука перед включением интеграции");
  }

  const existing = await prisma.integrationProfile.findFirst({ where: { system: "BITRIX24" } });
  const profile = existing
    ? await prisma.integrationProfile.update({
        where: { id: existing.id },
        data: { isEnabled, config: { webhookUrl } },
      })
    : await prisma.integrationProfile.create({
        data: { system: "BITRIX24", name: "Битрикс24", isEnabled, config: { webhookUrl } },
      });

  await logAudit({
    userId: session.userId,
    entityType: "integration_profile",
    entityId: profile.id,
    action: "update",
    after: { isEnabled, hasWebhook: Boolean(webhookUrl) } as never,
  });

  revalidatePath("/integrations/bitrix24");
}

export async function sendOutboxEventAction(eventId: string) {
  await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  await sendOutboxEvent(eventId);
  revalidatePath("/integrations/bitrix24");
}
