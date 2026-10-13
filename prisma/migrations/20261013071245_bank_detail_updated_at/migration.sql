-- AlterTable
ALTER TABLE "counterparty_bank_details" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing details: their last change is unknown, so the creation date stands in (no false alarms on approved requests).
UPDATE "counterparty_bank_details" SET "updatedAt" = "createdAt";
