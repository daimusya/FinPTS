import { Prisma } from "@prisma/client";
import { normalizeCurrency } from "@/lib/currency";
import { prisma } from "@/lib/db";
import { localDateKey } from "@/lib/payment-calendar";
import { matchStatement, STATEMENT_MATCH_DAYS } from "./statement-check";

const MATCH_WINDOW = STATEMENT_MATCH_DAYS * 86_400_000;

/** Закрывает согласованные заявки с графиком, когда каждому платежу соответствует отдельное списание. */
export async function settleSchedulesFromStatement(
  bankAccountId: string,
  importedOutflows: ReadonlyMap<string, string>,
  userId: string | null,
) {
  if (importedOutflows.size === 0) return;
  const counterparties = [...new Set(importedOutflows.values())];
  const today = new Date(`${localDateKey()}T00:00:00Z`);
  const tomorrow = new Date(today.getTime() + 86_400_000);

  await prisma.$transaction(async (db) => {
    const { organizationId } = await db.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId }, select: { organizationId: true } });
    // Use the same request row lock as manual payment and schedule changes.
    const locked = await db.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "payment_requests"
      WHERE "organizationId" = ${organizationId} AND "counterpartyId" IN (${Prisma.join(counterparties)})
        AND "status" = 'APPROVED'
        AND EXISTS (SELECT 1 FROM "payment_request_parts" WHERE "paymentRequestId" = "payment_requests"."id")
      ORDER BY "id" FOR NO KEY UPDATE
    `;
    if (locked.length === 0) return;
    const eligible = new Set(locked.map(({ id }) => id));
    // Other approved and paid requests still compete for the same bank operations.
    const requests = await db.paymentRequest.findMany({
      where: { organizationId, counterpartyId: { in: counterparties }, status: { in: ["APPROVED", "PAID"] } },
      select: { id: true, organizationId: true, counterpartyId: true, currency: true, status: true, amount: true, dueDate: true, parts: { select: { id: true, dueDate: true, amount: true, paidAt: true, statementTransactionId: true } } },
      orderBy: { id: "asc" },
    });
    let earliest = Infinity;
    let latest = -Infinity;
    for (const request of requests) {
      earliest = Math.min(earliest, request.dueDate.getTime());
      latest = Math.max(latest, request.dueDate.getTime());
      for (const part of request.parts) {
        earliest = Math.min(earliest, part.dueDate.getTime());
        latest = Math.max(latest, part.dueDate.getTime());
      }
    }
    const outflows = await db.bankTransaction.findMany({
      where: {
        bankAccount: { organizationId }, batchId: { not: null }, direction: "OUTFLOW", isTransfer: false,
        counterpartyId: { in: counterparties }, operationDate: { gte: new Date(earliest - MATCH_WINDOW), lte: new Date(latest + MATCH_WINDOW), lt: tomorrow },
      },
      select: { id: true, amount: true, counterpartyId: true, operationDate: true, bankAccount: { select: { currency: true } }, matchedRequestPart: { select: { id: true } } },
      orderBy: [{ operationDate: "asc" }, { id: "asc" }],
    });
    const { matches } = matchStatement(outflows.map((outflow) => ({
      ...outflow, organizationId, counterpartyId: outflow.counterpartyId!, currency: normalizeCurrency(outflow.bankAccount?.currency), matchedPartId: outflow.matchedRequestPart?.id,
    })), requests.map((request) => ({
      ...request,
      approvedAt: null,
      slots: [
        { key: "whole", amount: request.amount, dueDate: request.dueDate, paid: request.status === "PAID" },
        ...request.parts.map((part) => ({ key: part.id, amount: part.amount, dueDate: part.dueDate, paid: !!part.paidAt, statementTransactionId: part.statementTransactionId })),
      ],
    })), { requireUniqueRequest: true });
    const bySlot = new Map(matches.map(({ slotKey, outflow }) => [slotKey, outflow]));
    for (const request of requests) {
      if (!eligible.has(request.id) || request.status !== "APPROVED" || request.parts.length === 0) continue;
      const payments = request.parts.flatMap((part) => {
        const outflow = bySlot.get(`${request.id}:${part.id}`);
        return outflow ? [{ part, outflow }] : [];
      });
      if (payments.length !== request.parts.length || !payments.some(({ outflow }) => importedOutflows.has(outflow.id))) continue;

      await db.paymentRequest.update({ where: { id: request.id }, data: { status: "PAID" } });
      for (const { part, outflow } of payments) {
        if (!part.paidAt) {
          await db.paymentRequestPart.update({ where: { id: part.id }, data: { paidAt: outflow.operationDate, paidById: userId } });
        }
      }
      await db.auditLog.create({ data: {
        userId,
        entityType: "payment_request",
        entityId: request.id,
        action: "mark_paid_from_statement",
        beforeJson: { status: "APPROVED" },
        afterJson: { status: "PAID", payments: payments.map(({ part, outflow }) => ({ partId: part.id, bankTransactionId: outflow.id })) },
      } });
    }
  });
}
