-- AlterTable
ALTER TABLE "financial_scenario_new_services" ADD COLUMN     "launchCosts" DECIMAL(18,2),
ADD COLUMN     "monthlyFixedCosts" DECIMAL(18,2),
ADD COLUMN     "staffCostPerEmployee" DECIMAL(18,2),
ADD COLUMN     "staffHeadcount" INTEGER;
