import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { PERMISSIONS } from "@/lib/permissions";
import { showDueDate } from "@/lib/payment-calendar";
import { formatMoneyIn } from "@/lib/currency";
import { isDelegationActive, stepDeciders } from "./delegation";
import { usersSeeingOrganization } from "@/lib/access-scope";

type Decider = { userId: string; onBehalfOfId: string | null };

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
 * заместители. Только те, кому видна организация заявки: остальные не
 * смогут её открыть, и уведомление о ней им не положено. Если таких нет,
 * решает полный администратор (он может решить любой шаг) — он и в списке.
 */
export async function currentDeciders(requestId: string, date: Date = new Date()): Promise<Decider[]> {
  return (await decidersOf(requestId, date)).visible;
}

async function decidersOf(requestId: string, date: Date): Promise<{ all: Decider[]; visible: Decider[]; byAdmin: boolean }> {
  const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id: requestId }, select: { organizationId: true } });
  const all = await roleDeciders(requestId, date);
  const seeing = await usersSeeingOrganization(all.map((d) => d.userId), request.organizationId);
  const visible = all.filter((d) => seeing.has(d.userId));
  if (visible.length > 0) return { all, visible, byAdmin: false };
  const admins = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: PERMISSIONS.ADMIN_FULL } } } } } } },
    select: { id: true },
  });
  return { all, visible: admins.map((a) => ({ userId: a.id, onBehalfOfId: null })), byAdmin: true };
}

async function roleDeciders(requestId: string, date: Date): Promise<Decider[]> {
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

/**
 * Уведомить тех, кто сейчас решает шаг заявки (кроме самого автора события).
 * Если решать некому, об этом узнаёт автор заявки — иначе она молча зависнет.
 */
export async function notifyDeciders(requestId: string, exceptUserId?: string) {
  const request = await prisma.paymentRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { counterparty: true, organization: { select: { name: true } }, route: { include: { steps: true } } },
  });
  const { all, visible: deciders, byAdmin } = await decidersOf(requestId, new Date());
  const steps = request.route?.steps.length ?? 0;
  if (deciders.length === 0) {
    await notify([request.createdById], {
      title: "Заявку некому согласовать",
      body: `Заявка ${requestSummary(request)}. ${noDecidersReason(all.length > 0, request.organization.name)}`,
      link: `/payment-requests/${request.id}`,
    });
    return;
  }
  await notify(
    deciders.map((d) => d.userId),
    {
      title: `Заявка ждёт вашего решения${steps > 1 ? ` (шаг ${request.currentStep} из ${steps})` : ""}`,
      body: `Заявка ${requestSummary(request)}.${byAdmin ? " Обычных согласующих с доступом к организации нет — решение за администратором." : ""}`,
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

/** Почему шаг некому решать (нет ни согласующих с доступом, ни администратора) — для уведомления автору и карточки заявки. */
export function noDecidersReason(someoneInRole: boolean, organizationName: string): string {
  return someoneInRole
    ? `Ни у кого из согласующих этого шага нет доступа к организации «${organizationName}». Откройте им доступ в разделе «Пользователи».`
    : "В роли этого шага нет активных пользователей. Назначьте роль сотруднику в разделе «Пользователи».";
}

/** Кто числится согласующим шага без учёта доступа к организации — чтобы объяснить, почему решать некому. */
export async function hasDecidersIgnoringAccess(requestId: string): Promise<boolean> {
  return (await roleDeciders(requestId, new Date())).length > 0;
}
