ALTER TABLE "intermediary_commission_closings"
    ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "correctionReason" TEXT;

ALTER TABLE "intermediary_commission_closings"
    DROP CONSTRAINT "intermediary_commission_closings_pkey",
    ADD CONSTRAINT "intermediary_commission_closings_pkey" PRIMARY KEY ("intermediaryId", "month", "version"),
    ADD CONSTRAINT "intermediary_commission_closings_version_reason_check"
      CHECK (("version" = 1 AND "correctionReason" IS NULL)
         OR ("version" > 1 AND char_length(btrim("correctionReason")) BETWEEN 1 AND 1000 AND "correctionReason" IS NOT NULL));
