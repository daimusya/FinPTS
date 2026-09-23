-- CreateTable
CREATE TABLE "bank_classification_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "direction" "BankTransactionDirection",
    "purposeContains" TEXT,
    "counterpartyInn" TEXT,
    "amountEquals" DECIMAL(18,2),
    "cashFlowArticleId" TEXT,
    "departmentId" TEXT,
    "costCenterId" TEXT,
    "projectId" TEXT,
    "productServiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_classification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_classification_rules_priority_idx" ON "bank_classification_rules"("priority");

-- AddForeignKey
ALTER TABLE "bank_classification_rules" ADD CONSTRAINT "bank_classification_rules_cashFlowArticleId_fkey" FOREIGN KEY ("cashFlowArticleId") REFERENCES "cash_flow_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_classification_rules" ADD CONSTRAINT "bank_classification_rules_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_classification_rules" ADD CONSTRAINT "bank_classification_rules_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_classification_rules" ADD CONSTRAINT "bank_classification_rules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_classification_rules" ADD CONSTRAINT "bank_classification_rules_productServiceId_fkey" FOREIGN KEY ("productServiceId") REFERENCES "products_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
