CREATE TABLE "intermediary_receipts" (
    "id" TEXT NOT NULL,
    "intermediaryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL CHECK ("amount" > 0),
    "payerName" TEXT NOT NULL,
    "purpose" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "intermediary_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "intermediary_receipts_intermediaryId_fkey" FOREIGN KEY ("intermediaryId") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "intermediary_receipts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "intermediary_receipts_date_idx" ON "intermediary_receipts"("date");
CREATE INDEX "intermediary_receipts_intermediaryId_idx" ON "intermediary_receipts"("intermediaryId");
CREATE INDEX "intermediary_receipts_organizationId_idx" ON "intermediary_receipts"("organizationId");
