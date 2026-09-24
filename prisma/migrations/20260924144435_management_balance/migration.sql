-- AlterTable
ALTER TABLE "balance_articles" ADD COLUMN     "systemCode" TEXT;

-- AlterTable
ALTER TABLE "cash_flow_articles" ADD COLUMN     "balanceArticleId" TEXT;

-- CreateTable
CREATE TABLE "balance_entries" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "balanceArticleId" TEXT NOT NULL,
    "organizationId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "comment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "balance_entries_date_idx" ON "balance_entries"("date");

-- CreateIndex
CREATE UNIQUE INDEX "balance_articles_systemCode_key" ON "balance_articles"("systemCode");

-- AddForeignKey
ALTER TABLE "cash_flow_articles" ADD CONSTRAINT "cash_flow_articles_balanceArticleId_fkey" FOREIGN KEY ("balanceArticleId") REFERENCES "balance_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_balanceArticleId_fkey" FOREIGN KEY ("balanceArticleId") REFERENCES "balance_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_entries" ADD CONSTRAINT "balance_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Balance lines the report derives from operations get a system code (see BalanceArticle in the schema).
-- Matched by the names the seed uses; prisma/seed.ts sets the same codes on fresh databases.
UPDATE "balance_articles" SET "systemCode" = 'cash' WHERE "name" = 'Денежные средства' AND "systemCode" IS NULL;
UPDATE "balance_articles" SET "systemCode" = 'receivable' WHERE "name" = 'Дебиторская задолженность' AND "systemCode" IS NULL;
UPDATE "balance_articles" SET "systemCode" = 'advances_issued' WHERE "name" = 'Авансы выданные' AND "systemCode" IS NULL;
UPDATE "balance_articles" SET "systemCode" = 'payable' WHERE "name" = 'Кредиторская задолженность' AND "systemCode" IS NULL;
UPDATE "balance_articles" SET "systemCode" = 'advances_received' WHERE "name" = 'Авансы полученные' AND "systemCode" IS NULL;
UPDATE "balance_articles" SET "systemCode" = 'payroll_payable' WHERE "name" = 'Налоги и зарплата к выплате' AND "systemCode" IS NULL;
UPDATE "balance_articles" SET "systemCode" = 'retained_earnings' WHERE "name" = 'Нераспределённая прибыль' AND "systemCode" IS NULL;
