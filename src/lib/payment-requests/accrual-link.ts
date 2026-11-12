import type { Prisma } from "@prisma/client";
import { accrualScopeWhere, type AccessScope } from "@/lib/access-scope";
import { prisma } from "@/lib/db";

export function linkableAccrualWhere(scope: AccessScope, organizationId?: string, counterpartyId?: string | null): Prisma.AccrualDocumentWhereInput {
  return {
    AND: [
      accrualScopeWhere(scope),
      { status: "POSTED", direction: "EXPENSE", organizationId, counterpartyId: counterpartyId ?? undefined },
    ],
  };
}

export async function listLinkableAccruals(scope: AccessScope, organizationId?: string, counterpartyId?: string | null, currentId?: string | null) {
  return prisma.accrualDocument.findMany({
    where: {
      ...linkableAccrualWhere(scope, organizationId, counterpartyId),
      OR: [{ paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } }, ...(currentId ? [{ id: currentId }] : [])],
    },
    orderBy: [{ date: "desc" }, { number: "asc" }],
    select: {
      id: true, number: true, date: true,
      organization: { select: { name: true, shortName: true } },
      counterparty: { select: { fullName: true, shortName: true } },
    },
  });
}
