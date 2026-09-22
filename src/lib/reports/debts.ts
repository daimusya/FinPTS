import { prisma } from "@/lib/db";
import { sumMoney } from "@/lib/money";
import Decimal from "decimal.js";
import type { ReportFilters } from "./filters";
import { accrualScopeWhere, UNRESTRICTED_SCOPE, type AccessScope } from "@/lib/access-scope";

export interface DebtDocument {
  id: string;
  number: string;
  documentType: string;
  dueDate: Date | null;
  remaining: Decimal;
  overdue: boolean;
}

export interface DebtRow {
  counterpartyId: string;
  counterpartyName: string;
  total: Decimal;
  overdue: Decimal;
  documents: DebtDocument[];
}

export interface DebtsReport {
  receivableRows: DebtRow[];
  payableRows: DebtRow[];
  totalReceivable: Decimal;
  totalPayable: Decimal;
  overdueReceivable: Decimal;
  overduePayable: Decimal;
}

export async function computeDebtsReport(
  filters: ReportFilters,
  scope: AccessScope = UNRESTRICTED_SCOPE,
): Promise<DebtsReport> {
  const documents = await prisma.accrualDocument.findMany({
    where: {
      AND: [
        { status: "POSTED", paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
        ...(filters.organizationId ? [{ organizationId: filters.organizationId }] : []),
        ...(filters.counterpartyId ? [{ counterpartyId: filters.counterpartyId }] : []),
        accrualScopeWhere(scope),
      ],
    },
    include: { counterparty: true, lines: true, allocations: { where: { cancelledAt: null } } },
    orderBy: { dueDate: "asc" },
  });

  const now = new Date();
  const receivables = new Map<string, DebtRow>();
  const payables = new Map<string, DebtRow>();

  for (const doc of documents) {
    const total = sumMoney(doc.lines.map((l) => l.amount));
    const allocated = sumMoney(doc.allocations.map((a) => a.amount));
    const remaining = total.minus(allocated);
    if (remaining.lessThanOrEqualTo(0)) continue;

    const isOverdue = Boolean(doc.dueDate && doc.dueDate < now);
    const bucket = doc.direction === "INCOME" ? receivables : payables;
    const key = doc.counterpartyId;
    const row =
      bucket.get(key) ??
      ({
        counterpartyId: key,
        counterpartyName: doc.counterparty.shortName || doc.counterparty.fullName,
        total: new Decimal(0),
        overdue: new Decimal(0),
        documents: [],
      } as DebtRow);

    row.total = row.total.plus(remaining);
    if (isOverdue) row.overdue = row.overdue.plus(remaining);
    row.documents.push({
      id: doc.id,
      number: doc.number,
      documentType: doc.documentType,
      dueDate: doc.dueDate,
      remaining,
      overdue: isOverdue,
    });
    bucket.set(key, row);
  }

  const receivableRows = Array.from(receivables.values()).sort((a, b) => b.total.comparedTo(a.total));
  const payableRows = Array.from(payables.values()).sort((a, b) => b.total.comparedTo(a.total));

  return {
    receivableRows,
    payableRows,
    totalReceivable: sumMoney(receivableRows.map((r) => r.total)),
    totalPayable: sumMoney(payableRows.map((r) => r.total)),
    overdueReceivable: sumMoney(receivableRows.map((r) => r.overdue)),
    overduePayable: sumMoney(payableRows.map((r) => r.overdue)),
  };
}
