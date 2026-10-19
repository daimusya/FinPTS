import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  DUPLICATE_CANDIDATE_STATUSES,
  DUPLICATE_SUBJECT_STATUSES,
  duplicateSearchRange,
  matchDuplicates,
  type DuplicateCandidate,
} from "@/lib/payment-requests/duplicates";

/**
 * Возможные дубли для набора заявок — одним запросом. scopeWhere ограничивает
 * кандидатов тем, что пользователь вправе видеть (ссылки на чужие заявки не показываем).
 */
export async function findPossibleDuplicates(subjects: DuplicateCandidate[], scopeWhere: Prisma.PaymentRequestWhereInput = {}) {
  const relevant = subjects.filter((s) => s.counterpartyId && (DUPLICATE_SUBJECT_STATUSES as readonly string[]).indexOf(s.status) >= 0);
  const range = duplicateSearchRange(relevant);
  if (!range) return new Map<string, Awaited<ReturnType<typeof loadCandidates>>>();
  const candidates = await loadCandidates(relevant, range, scopeWhere);
  return matchDuplicates(relevant, candidates);
}

function loadCandidates(subjects: DuplicateCandidate[], range: { from: Date; to: Date }, scopeWhere: Prisma.PaymentRequestWhereInput) {
  return prisma.paymentRequest.findMany({
    where: {
      AND: [
        scopeWhere,
        {
          counterpartyId: { in: [...new Set(subjects.map((s) => s.counterpartyId!))] },
          status: { in: [...DUPLICATE_CANDIDATE_STATUSES] },
          dueDate: { gte: range.from, lte: range.to },
        },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      counterpartyId: true,
      amount: true,
      currency: true,
      dueDate: true,
      status: true,
      createdAt: true,
      createdBy: { select: { fullName: true } },
    },
  });
}
