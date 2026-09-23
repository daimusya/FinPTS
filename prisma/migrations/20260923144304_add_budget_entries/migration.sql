-- CreateEnum
CREATE TYPE "BudgetKind" AS ENUM ('CASH_FLOW', 'PNL');

-- CreateTable
CREATE TABLE "budget_entries" (
    "id" TEXT NOT NULL,
    "kind" "BudgetKind" NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "organizationId" TEXT,
    "cashFlowArticleId" TEXT,
    "pnlArticleId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "budget_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_entries_kind_year_month_idx" ON "budget_entries"("kind", "year", "month");

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_cashFlowArticleId_fkey" FOREIGN KEY ("cashFlowArticleId") REFERENCES "cash_flow_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_entries" ADD CONSTRAINT "budget_entries_pnlArticleId_fkey" FOREIGN KEY ("pnlArticleId") REFERENCES "pnl_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
