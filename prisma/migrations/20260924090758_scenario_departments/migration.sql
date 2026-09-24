-- CreateTable
CREATE TABLE "financial_scenario_departments" (
    "scenarioId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_scenario_departments_pkey" PRIMARY KEY ("scenarioId","departmentId")
);

-- AddForeignKey
ALTER TABLE "financial_scenario_departments" ADD CONSTRAINT "financial_scenario_departments_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "financial_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_scenario_departments" ADD CONSTRAINT "financial_scenario_departments_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
