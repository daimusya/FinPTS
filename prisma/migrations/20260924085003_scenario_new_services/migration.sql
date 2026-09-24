-- CreateTable
CREATE TABLE "financial_scenario_new_services" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productServiceId" TEXT,
    "launchYear" INTEGER NOT NULL,
    "launchMonth" INTEGER NOT NULL,
    "avgCheck" DECIMAL(18,2) NOT NULL,
    "salesPerMonth" DECIMAL(18,2) NOT NULL,
    "rampUpMonths" INTEGER NOT NULL DEFAULT 0,
    "variableCostPct" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_scenario_new_services_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_scenario_new_services_scenarioId_idx" ON "financial_scenario_new_services"("scenarioId");

-- AddForeignKey
ALTER TABLE "financial_scenario_new_services" ADD CONSTRAINT "financial_scenario_new_services_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "financial_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_scenario_new_services" ADD CONSTRAINT "financial_scenario_new_services_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES "products_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
