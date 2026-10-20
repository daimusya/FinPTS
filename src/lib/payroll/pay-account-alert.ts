import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { PERMISSIONS } from "@/lib/permissions";
import { usersSeeingOrganization } from "@/lib/access-scope";
import { maskPayAccount } from "@/lib/payroll/pay-account";

/**
 * Сменился счёт или карта сотрудника для зарплаты — сразу сообщить тем, кто
 * ведёт зарплату в его организации, и самому сотруднику, если у него есть вход
 * в систему: подмена счёта уводит зарплату, и заметить её нужно до выплаты.
 * Автор изменения уведомление не получает.
 */
export async function alertPayAccountChanged(input: {
  employeeId: string;
  employeeName: string;
  employeeUserId: string | null;
  organizationId: string;
  actorId: string;
  previous: string | null;
  next: string | null;
}) {
  const payroll = await prisma.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { permissions: { some: { permission: { code: { in: [PERMISSIONS.PAYROLL_MANAGE, PERMISSIONS.ADMIN_FULL] } } } } } } },
    },
    select: { id: true },
  });
  const recipients = await usersSeeingOrganization(payroll.map((u) => u.id), input.organizationId);
  const change = `${maskPayAccount(input.previous)} → ${maskPayAccount(input.next)}`;
  let sent = 0;
  // The employee may not see the employee card: a plain message of their own, without a link.
  if (input.employeeUserId && !recipients.has(input.employeeUserId)) {
    const own = await prisma.user.findFirst({ where: { id: input.employeeUserId, isActive: true }, select: { id: true } });
    if (own) {
      sent += await notify(
        [own.id],
        {
          title: "Изменён ваш счёт для зарплаты",
          body: `Ваш счёт для зарплаты изменён: ${change}. Если вы этого не просили — сразу сообщите в бухгалтерию.`,
        },
        input.actorId,
      );
    }
  }
  sent += await notify(
    [...recipients],
    {
      title: "Изменён счёт для зарплаты",
      body: `У сотрудника ${input.employeeName} счёт для зарплаты изменён: ${change}. Если изменение не согласовано с сотрудником лично — проверьте до выплаты.`,
      link: `/employees/${input.employeeId}`,
    },
    input.actorId,
  );
  return sent;
}
