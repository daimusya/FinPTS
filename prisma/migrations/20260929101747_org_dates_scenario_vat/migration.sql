-- AlterTable
ALTER TABLE "financial_scenarios" ADD COLUMN     "vatRatePct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "closureDate" DATE,
ADD COLUMN     "registrationDate" DATE;
