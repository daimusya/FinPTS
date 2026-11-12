CREATE TABLE "intermediary_commission_closings" (
    "intermediaryId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "report" JSONB NOT NULL,
    "fixedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fixedById" TEXT,
    CONSTRAINT "intermediary_commission_closings_pkey" PRIMARY KEY ("intermediaryId", "month"),
    CONSTRAINT "intermediary_commission_closings_intermediaryId_fkey" FOREIGN KEY ("intermediaryId") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "intermediary_commission_closings_fixedById_fkey" FOREIGN KEY ("fixedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "intermediary_commission_closings_month_idx" ON "intermediary_commission_closings"("month");
