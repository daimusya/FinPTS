-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "transferGroupId" TEXT;

-- CreateIndex
CREATE INDEX "bank_transactions_transferGroupId_idx" ON "bank_transactions"("transferGroupId");
