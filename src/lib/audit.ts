import { prisma } from "./db";
import type { Prisma } from "@prisma/client";
import { redactSecrets } from "./audit-view";

export interface AuditEntry {
  userId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  accrualDocumentId?: string;
}

export async function logAudit(entry: AuditEntry) {
  await prisma.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      // Password hashes, link codes, tokens and keys never reach the journal.
      beforeJson: entry.before ? redactSecrets(entry.before) : undefined,
      afterJson: entry.after ? redactSecrets(entry.after) : undefined,
      accrualDocumentId: entry.accrualDocumentId,
    },
  });
}
