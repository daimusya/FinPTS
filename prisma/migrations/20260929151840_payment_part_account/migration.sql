-- AlterTable
ALTER TABLE "payment_request_parts" ADD COLUMN     "payBankAccountId" TEXT,
ADD COLUMN     "payCashAccountId" TEXT;

-- AddForeignKey
ALTER TABLE "payment_request_parts" ADD CONSTRAINT "payment_request_parts_payBankAccountId_fkey" FOREIGN KEY ("payBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_parts" ADD CONSTRAINT "payment_request_parts_payCashAccountId_fkey" FOREIGN KEY ("payCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
