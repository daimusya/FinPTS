-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "counterpartyName" TEXT;

-- CreateTable
CREATE TABLE "intermediaries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportName" TEXT,
    "commissionPct" DECIMAL(5,2),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intermediaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intermediary_clients" (
    "id" TEXT NOT NULL,
    "intermediaryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "intermediary_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intermediary_payers" (
    "inn" TEXT NOT NULL,
    "intermediaryId" TEXT,
    "payerName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intermediary_payers_pkey" PRIMARY KEY ("inn")
);

-- CreateIndex
CREATE UNIQUE INDEX "intermediaries_name_key" ON "intermediaries"("name");

-- CreateIndex
CREATE UNIQUE INDEX "intermediary_clients_intermediaryId_name_key" ON "intermediary_clients"("intermediaryId", "name");

-- CreateIndex
CREATE INDEX "intermediary_payers_intermediaryId_idx" ON "intermediary_payers"("intermediaryId");

-- AddForeignKey
ALTER TABLE "intermediary_clients" ADD CONSTRAINT "intermediary_clients_intermediaryId_fkey" FOREIGN KEY ("intermediaryId") REFERENCES "intermediaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intermediary_payers" ADD CONSTRAINT "intermediary_payers_intermediaryId_fkey" FOREIGN KEY ("intermediaryId") REFERENCES "intermediaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
