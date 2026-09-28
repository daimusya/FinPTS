-- AlterTable
ALTER TABLE "financial_scenarios" ADD COLUMN     "taxOrganizationId" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "taxSystem" TEXT NOT NULL DEFAULT 'osn';

-- CreateTable
CREATE TABLE "organization_tax_rates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taxKind" TEXT NOT NULL,
    "ratePct" DECIMAL(6,3) NOT NULL,
    "validFrom" DATE NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_tax_rates_organizationId_taxKind_validFrom_key" ON "organization_tax_rates"("organizationId", "taxKind", "validFrom");

-- AddForeignKey
ALTER TABLE "organization_tax_rates" ADD CONSTRAINT "organization_tax_rates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_scenarios" ADD CONSTRAINT "financial_scenarios_taxOrganizationId_fkey" FOREIGN KEY ("taxOrganizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
