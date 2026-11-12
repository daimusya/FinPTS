import { PERMISSIONS } from "@/lib/permissions";
import { hasPermission, type SessionPayload } from "@/lib/session";

export function canViewPaymentRequests(session: SessionPayload): boolean {
  return [
    PERMISSIONS.CASH_VIEW,
    PERMISSIONS.CASH_MANAGE,
    PERMISSIONS.PAYMENT_REQUEST_CREATE,
    PERMISSIONS.PAYMENT_REQUEST_APPROVE,
  ].some((permission) => hasPermission(session, permission));
}
