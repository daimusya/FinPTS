-- AlterTable
ALTER TABLE "counterparty_contacts" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- The first contact of each counterparty (alphabetically) becomes its primary one.
UPDATE "counterparty_contacts" SET "isPrimary" = true
WHERE "id" IN (
  SELECT DISTINCT ON ("counterpartyId") "id" FROM "counterparty_contacts" ORDER BY "counterpartyId", "name", "id"
);
