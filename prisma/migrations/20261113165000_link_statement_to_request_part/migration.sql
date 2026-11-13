ALTER TABLE "payment_request_parts" ADD COLUMN "statementTransactionId" TEXT;
CREATE UNIQUE INDEX "payment_request_parts_statementTransactionId_key" ON "payment_request_parts"("statementTransactionId");
ALTER TABLE "payment_request_parts" ADD CONSTRAINT "payment_request_parts_statementTransactionId_fkey"
    FOREIGN KEY ("statementTransactionId") REFERENCES "bank_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
