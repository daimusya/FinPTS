import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { PERMISSIONS } from "@/lib/permissions";
import { usersSeeingOrganization } from "@/lib/access-scope";
import { formatMoneyIn } from "@/lib/currency";

/**
 * Основной счёт контрагента сменился, а у него есть заявки к оплате (на
 * согласовании или согласованные): сразу сообщить авторам этих заявок и тем,
 * кто проводит оплаты, — подмена получателя между согласованием и оплатой
 * должна быть замечена до платежа, а не после. Автор изменения уведомление не
 * получает.
 */
export async function alertPayeeChanged(input: { counterpartyId: string; actorId: string; previousAccount: string | null; newAccount: string | null }) {
  const requests = await prisma.paymentRequest.findMany({
    where: { counterpartyId: input.counterpartyId, status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
    select: { id: true, organizationId: true, createdById: true, amount: true, currency: true, counterparty: { select: { shortName: true, fullName: true } } },
  });
  if (requests.length === 0) return 0;

  const payers = await prisma.user.findMany({
    where: {
      isActive: true,
      roles: { some: { role: { permissions: { some: { permission: { code: { in: [PERMISSIONS.CASH_MANAGE, PERMISSIONS.ADMIN_FULL] } } } } } } },
    },
    select: { id: true },
  });
  const recipients = new Set<string>();
  for (const r of requests) {
    const candidates = [r.createdById, ...payers.map((p) => p.id)];
    for (const id of await usersSeeingOrganization(candidates, r.organizationId)) recipients.add(id);
  }

  const name = requests[0].counterparty?.shortName || requests[0].counterparty?.fullName || "контрагент";
  const sums = requests.map((r) => formatMoneyIn(r.amount.toString(), r.currency)).join(", ");
  const change =
    input.previousAccount && input.newAccount
      ? `с р/с ${input.previousAccount} на р/с ${input.newAccount}`
      : input.newAccount
        ? `на р/с ${input.newAccount}`
        : "— основного счёта больше нет";
  return notify(
    [...recipients],
    {
      title: "Изменены реквизиты получателя по заявкам к оплате",
      body: `У контрагента «${name}» сменился основной счёт ${change}. Заявок к оплате: ${requests.length} (${sums}). Перед оплатой сверьте реквизиты с контрагентом по известному телефону.`,
      link: requests.length === 1 ? `/payment-requests/${requests[0].id}` : `/payment-requests?q=${encodeURIComponent(name)}`,
    },
    input.actorId,
  );
}
