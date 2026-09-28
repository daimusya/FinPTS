-- AlterTable
ALTER TABLE "counterparty_bank_details" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Existing counterparties with bank details: the first account (by id) becomes primary.
UPDATE "counterparty_bank_details" SET "isPrimary" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("counterpartyId") "id" FROM "counterparty_bank_details" ORDER BY "counterpartyId", "id"
);
