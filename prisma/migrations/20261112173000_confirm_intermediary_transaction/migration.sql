ALTER TABLE "bank_transactions" ADD COLUMN "commissionIntermediaryId" TEXT;
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_commissionIntermediaryId_fkey" FOREIGN KEY ("commissionIntermediaryId") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
