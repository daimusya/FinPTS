import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { PERMISSIONS } from "@/lib/permissions";
import { showDueDate } from "@/lib/payment-calendar";
import { formatMoneyIn } from "@/lib/currency";
import { isDelegationActive, stepDeciders } from "./delegation";

type RequestForNotice = {
  id: string;
  amount: { toString(): string };
  currency?: string;
  dueDate: Date;
  dueTime?: string | null;
  createdById: string;
  counterparty?: { shortName: string | null; fullName: string } | null;
};

/** «на 120 000,00 ₽ для ООО «Орион», срок 15.10.2026» */
export function requestSummary(request: RequestForNotice): string {
  const who = request.counterparty ? ` для ${request.counterparty.shortName || request.counterparty.fullName}` : "";
  return `на ${formatMoneyIn(request.amount.toString(), request.currency ?? "RUB")}${who}, срок ${showDueDate(request.dueDate, request.dueTime)}`;
}

/**
 * Кто может решать текущий шаг заявки: по маршруту — участники роли шага,
 * без маршрута — у кого есть право согласования заявок; и их действующие
 * заместители.
 */
export async function currentDeciders(requestId: string, date: Date = new Date()): Promise<Array<{ userId: string; onBehalfOfId: string | null }>> {
  const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId }, include: { route: { include: { steps: true } } } });
  if (request.route) {
    const step = request.route.steps.find((s) => s.stepOrder === request.currentStep);
    return step ? stepDeciders(step.roleId, date) : [];
  }
  const holders = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: PERMISSIONS.PAYMENT_REQUEST_APPROVE } } } } } } },
    select: { id: true },
  });
  const ids = holders.map((h) => h.id);
  const delegations = ids.length ? await prisma.approvalDelegation.findMany({ where: { fromUserId: { in: ids }, toUser: { isActive: true } } }) : [];
  return [
    ...ids.map((userId) => ({ userId, onBehalfOfId: null })),
    ...delegations.filter((d) => isDelegationActive(d, date)).map((d) => ({ userId: d.toUserId, onBehalfOfId: d.fromUserId })),
  ];
}

/** Уведомить тех, кто сейчас решает шаг заявки (кроме самого автора события). */
export async function notifyDeciders(requestId: string, exceptUserId?: string) {
  const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId }, include: { counterparty: true, route: { include: { steps: true } } } });
  const deciders = await currentDeciders(requestId);
  const steps = request.route?.steps.length ?? 0;
  await notify(
    deciders.map((d) => d.userId),
    {
      title: `Заявка ждёт вашего решения${steps > 1 ? ` (шаг ${request.currentStep} из ${steps})` : ""}`,
      body: `Заявка ${requestSummary(request)}.`,
      link: `/payment-requests/${request.id}`,
    },
    exceptUserId,
  );
}

/** Уведомить автора заявки о событии (решении, оплате, отмене). */
export async function notifyAuthor(requestId: string, title: string, details: string | null, exceptUserId?: string) {
  const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId }, include: { counterparty: true } });
  await notify(
    [request.createdById],
    { title, body: `Заявка ${requestSummary(request)}.${details ? ` ${details}` : ""}`, link: `/payment-requests/${request.id}` },
    exceptUserId,
  );
}
