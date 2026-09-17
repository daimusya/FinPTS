import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * Идемпотентная постановка события в очередь на отправку в Битрикс24.
 * idempotencyKey должен однозначно определять состояние на момент события
 * (например `payment_status:<documentId>:<status>:<allocatedAmount>`), чтобы
 * повторный вызов с тем же состоянием не создавал дубль.
 */
export async function enqueueOutboxEvent(params: {
  eventType: string;
  targetSystem: string;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.integrationOutbox.upsert({
    where: { idempotencyKey: params.idempotencyKey },
    update: {},
    create: {
      eventType: params.eventType,
      targetSystem: params.targetSystem,
      idempotencyKey: params.idempotencyKey,
      payload: params.payload,
    },
  });
}

export interface SendResult {
  ok: boolean;
  error?: string;
}

/**
 * Отправляет одно событие в вебхук профиля интеграции. Если профиль не
 * настроен или отключён, событие остаётся в очереди со статусом pending —
 * это осознанное поведение (в этой версии нет реального адреса Битрикс24),
 * а не ошибка.
 */
export async function sendOutboxEvent(eventId: string): Promise<SendResult> {
  const [event, profile] = await Promise.all([
    prisma.integrationOutbox.findUniqueOrThrow({ where: { id: eventId } }),
    prisma.integrationProfile.findFirst({ where: { system: "BITRIX24" } }),
  ]);

  const webhookUrl = (profile?.config as { webhookUrl?: string } | null)?.webhookUrl;
  if (!profile?.isEnabled || !webhookUrl) {
    return { ok: false, error: "Интеграция с Битрикс24 не настроена или отключена" };
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: event.eventType, payload: event.payload }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await prisma.integrationOutbox.update({
      where: { id: eventId },
      data: { status: "sent", sentAt: new Date(), attempts: { increment: 1 }, lastError: null },
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Неизвестная ошибка отправки";
    await prisma.integrationOutbox.update({
      where: { id: eventId },
      data: { status: "failed", attempts: { increment: 1 }, lastError: message },
    });
    return { ok: false, error: message };
  }
}
