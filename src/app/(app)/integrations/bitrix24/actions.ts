"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { sendOutboxEvent } from "@/lib/integrations/outbox";
import { encryptSecret } from "@/lib/crypto/secret-box";
import { enqueueProjectResults } from "@/lib/integrations/project-results";
import { redirect } from "next/navigation";

export async function saveBitrix24ProfileAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);

  const newWebhookUrl = String(formData.get("webhookUrl") ?? "").trim();
  const isEnabled = formData.get("isEnabled") === "on";

  const existing = await prisma.integrationProfile.findFirst({ where: { system: "BITRIX24" } });
  const existingConfig = existing?.config as { webhookUrlEnc?: string } | null;

  // Пустое поле = «оставить как есть» (в форме показывается маска, а не
  // расшифрованное значение), непустое = заменить и зашифровать заново.
  const webhookUrlEnc = newWebhookUrl ? encryptSecret(newWebhookUrl) : existingConfig?.webhookUrlEnc;

  if (isEnabled && !webhookUrlEnc) {
    throw new Error("Укажите адрес вебхука перед включением интеграции");
  }

  const profile = existing
    ? await prisma.integrationProfile.update({
        where: { id: existing.id },
        data: { isEnabled, config: { webhookUrlEnc } },
      })
    : await prisma.integrationProfile.create({
        data: { system: "BITRIX24", name: "Битрикс24", isEnabled, config: { webhookUrlEnc } },
      });

  await logAudit({
    userId: session.userId,
    entityType: "integration_profile",
    entityId: profile.id,
    action: "update",
    after: { isEnabled, hasWebhook: Boolean(webhookUrlEnc), webhookChanged: Boolean(newWebhookUrl) } as never,
  });

  revalidatePath("/integrations/bitrix24");
}

/** Пересчитать финансовый результат всех проектов со сделкой и поставить изменившиеся в очередь. */
export async function enqueueAllProjectResultsAction() {
  const session = await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  const { checked, queued } = await enqueueProjectResults();
  await logAudit({
    userId: session.userId,
    entityType: "integration_outbox",
    entityId: "project_financial_result",
    action: "enqueue_project_results",
    after: { checked, queued } as never,
  });
  revalidatePath("/integrations/bitrix24");
  redirect(`/integrations/bitrix24?checked=${checked}&queued=${queued}`);
}

export async function sendOutboxEventAction(eventId: string) {
  await requirePermission(PERMISSIONS.INTEGRATIONS_MANAGE);
  await sendOutboxEvent(eventId);
  revalidatePath("/integrations/bitrix24");
}
