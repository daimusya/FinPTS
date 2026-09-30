-- AlterTable
ALTER TABLE "accrual_document_lines" ADD COLUMN     "currencyAmount" DECIMAL(18,2),
ADD COLUMN     "currencyVatAmount" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "accrual_documents" ADD COLUMN     "currency" VARCHAR(3) NOT NULL DEFAULT 'RUB',
ADD COLUMN     "exchangeRate" DECIMAL(18,6);

-- AlterTable
ALTER TABLE "payment_allocations" ADD COLUMN     "currencyAmount" DECIMAL(18,2),
ADD COLUMN     "transactionAmount" DECIMAL(18,2);
