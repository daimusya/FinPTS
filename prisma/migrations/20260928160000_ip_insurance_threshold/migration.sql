-- AlterTable
ALTER TABLE "organization_tax_rates" ADD COLUMN     "maxAmount" DECIMAL(18,2),
ADD COLUMN     "thresholdAmount" DECIMAL(18,2);
