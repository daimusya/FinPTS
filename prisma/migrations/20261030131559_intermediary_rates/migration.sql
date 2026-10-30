-- CreateTable
CREATE TABLE "intermediary_rates" (
    "id" TEXT NOT NULL,
    "intermediaryId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intermediary_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intermediary_rates_intermediaryId_validFrom_key" ON "intermediary_rates"("intermediaryId", "validFrom");

-- AddForeignKey
ALTER TABLE "intermediary_rates" ADD CONSTRAINT "intermediary_rates_intermediaryId_fkey" FOREIGN KEY ("intermediaryId") REFERENCES "intermediaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
