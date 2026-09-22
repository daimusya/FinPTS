/*
  Warnings:

  - Made the column `dimension` on table `financial_scenario_values` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "financial_scenario_values" ALTER COLUMN "dimension" SET NOT NULL,
ALTER COLUMN "dimension" SET DEFAULT '';

-- AddForeignKey
ALTER TABLE "bank_import_batches" ADD CONSTRAINT "bank_import_batches_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_sheets" ADD CONSTRAINT "time_sheets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
