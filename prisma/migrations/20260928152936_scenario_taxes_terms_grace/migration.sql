-- AlterTable
ALTER TABLE "financial_scenario_loans" ADD COLUMN     "graceMonths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "prepaymentAmount" DECIMAL(18,2),
ADD COLUMN     "prepaymentMonth" INTEGER,
ADD COLUMN     "prepaymentYear" INTEGER;

-- AlterTable
ALTER TABLE "financial_scenario_new_services" ADD COLUMN     "customerPaymentDays" INTEGER;

-- AlterTable
ALTER TABLE "financial_scenarios" ADD COLUMN     "taxRatePct" DECIMAL(5,2),
ADD COLUMN     "taxRegime" TEXT NOT NULL DEFAULT 'none';
