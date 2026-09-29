import { prisma } from "@/lib/db";

/**
 * Замещение согласующего на время отпуска: в период validFrom–validTo
 * (включительно, по дням) заместитель принимает решения по шагам, положенным
 * замещаемому. Решение записывается от имени заместителя с пометкой «за
 * такого-то».
 */
export interface DelegationPeriod {
  fromUserId: string;
  toUserId: string;
  validFrom: Date;
  validTo: Date;
}

const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Действует ли замещение в этот день. */
export function isDelegationActive(delegation: Pick<DelegationPeriod, "validFrom" | "validTo">, date: Date): boolean {
  return day(delegation.validFrom) <= day(date) && day(date) <= day(delegation.validTo);
}

/** Проверка формы замещения: разные люди, конец не раньше начала, не дольше года. */
export function validateDelegation(input: { fromUserId: string; toUserId: string; validFrom: Date | null; validTo: Date | null }): string | null {
  if (!input.fromUserId || !input.toUserId) return "Выберите, кого замещают и кто замещает";
  if (input.fromUserId === input.toUserId) return "Заместитель должен быть другим пользователем";
  if (!input.validFrom || !input.validTo) return "Укажите даты начала и окончания замещения";
  if (day(input.validTo) < day(input.validFrom)) return "Дата окончания раньше даты начала";
  if (day(input.validTo) - day(input.validFrom) > 366 * 86_400_000) return "Замещение — не дольше года";
  return null;
}

/**
 * Кто сейчас может решать шаг с этой ролью: участники роли и их действующие
 * заместители; для заместителя — за кого он решает. Неактивные пользователи
 * не считаются.
 */
export async function stepDeciders(roleId: string, date: Date = new Date()): Promise<Array<{ userId: string; onBehalfOfId: string | null }>> {
  const members = await prisma.userRole.findMany({ where: { roleId, user: { isActive: true } }, select: { userId: true } });
  const memberIds = members.map((m) => m.userId);
  const delegations = memberIds.length
    ? await prisma.approvalDelegation.findMany({
        where: { fromUserId: { in: memberIds }, validFrom: { lte: date }, validTo: { gte: new Date(day(date)) }, toUser: { isActive: true } },
      })
    : [];
  return [
    ...memberIds.map((userId) => ({ userId, onBehalfOfId: null })),
    ...delegations.filter((d) => isDelegationActive(d, date)).map((d) => ({ userId: d.toUserId, onBehalfOfId: d.fromUserId })),
  ];
}

/**
 * Может ли пользователь решать шаг с этой ролью: сам в роли — да; иначе —
 * если замещает кого-то из роли сегодня (тогда onBehalfOfId — за кого).
 */
export async function stepAuthority(userId: string, roleId: string, date: Date = new Date()): Promise<{ allowed: boolean; onBehalfOfId: string | null }> {
  const deciders = await stepDeciders(roleId, date);
  if (deciders.some((d) => d.userId === userId && d.onBehalfOfId === null)) return { allowed: true, onBehalfOfId: null };
  const delegated = deciders.find((d) => d.userId === userId);
  return delegated ? { allowed: true, onBehalfOfId: delegated.onBehalfOfId } : { allowed: false, onBehalfOfId: null };
}
