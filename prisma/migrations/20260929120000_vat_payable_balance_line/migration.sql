-- VAT owed to the budget: output VAT of posted income documents minus deductible input VAT, plus entries and linked cash flows
-- (see src/lib/reports/balance.ts); prisma/seed.ts adds the same on fresh databases.
INSERT INTO "balance_articles" ("id", "name", "category", "systemCode", "isArchived")
SELECT gen_random_uuid()::text, 'НДС к уплате', 'LIABILITY', 'vat_payable', false
WHERE NOT EXISTS (SELECT 1 FROM "balance_articles" WHERE "systemCode" = 'vat_payable');
