-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inventoryNumber" TEXT,
    "organizationId" TEXT NOT NULL,
    "departmentId" TEXT,
    "pnlArticleId" TEXT NOT NULL,
    "cost" DECIMAL(18,2) NOT NULL,
    "commissioningDate" DATE NOT NULL,
    "usefulLifeMonths" INTEGER NOT NULL,
    "disposalDate" DATE,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_agreements" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "balanceArticleId" TEXT NOT NULL,
    "pnlArticleId" TEXT NOT NULL,
    "annualRatePct" DECIMAL(6,3) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_agreements_balanceArticleId_key" ON "credit_agreements"("balanceArticleId");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_pnlArticleId_fkey" FOREIGN KEY ("pnlArticleId") REFERENCES "pnl_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_agreements" ADD CONSTRAINT "credit_agreements_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_agreements" ADD CONSTRAINT "credit_agreements_balanceArticleId_fkey" FOREIGN KEY ("balanceArticleId") REFERENCES "balance_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_agreements" ADD CONSTRAINT "credit_agreements_pnlArticleId_fkey" FOREIGN KEY ("pnlArticleId") REFERENCES "pnl_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Balance lines for depreciation and loan interest (see src/lib/reports/non-cash.ts); prisma/seed.ts adds the same on fresh databases.
INSERT INTO "balance_articles" ("id", "name", "category", "systemCode", "isArchived")
SELECT gen_random_uuid()::text, 'Накопленная амортизация', 'ASSET', 'accumulated_depreciation', false
WHERE NOT EXISTS (SELECT 1 FROM "balance_articles" WHERE "systemCode" = 'accumulated_depreciation');
INSERT INTO "balance_articles" ("id", "name", "category", "systemCode", "isArchived")
SELECT gen_random_uuid()::text, 'Проценты к уплате', 'LIABILITY', 'interest_payable', false
WHERE NOT EXISTS (SELECT 1 FROM "balance_articles" WHERE "systemCode" = 'interest_payable');
INSERT INTO "balance_articles" ("id", "name", "category", "isArchived")
SELECT gen_random_uuid()::text, 'Основные средства', 'ASSET', false
WHERE NOT EXISTS (SELECT 1 FROM "balance_articles" WHERE "name" = 'Основные средства');
