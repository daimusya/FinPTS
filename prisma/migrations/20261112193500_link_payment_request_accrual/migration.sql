ALTER TABLE "payment_requests" ADD COLUMN "accrualDocumentId" TEXT;
CREATE INDEX "payment_requests_accrualDocumentId_idx" ON "payment_requests"("accrualDocumentId");
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_accrualDocumentId_fkey"
    FOREIGN KEY ("accrualDocumentId") REFERENCES "accrual_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
