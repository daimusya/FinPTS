-- CreateTable
CREATE TABLE "financial_scenario_loans" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "startYear" INTEGER NOT NULL,
    "startMonth" INTEGER NOT NULL,
    "annualRatePct" DECIMAL(6,3) NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "repayment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_scenario_loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_scenario_loans_scenarioId_idx" ON "financial_scenario_loans"("scenarioId");

-- AddForeignKey
ALTER TABLE "financial_scenario_loans" ADD CONSTRAINT "financial_scenario_loans_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "financial_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
