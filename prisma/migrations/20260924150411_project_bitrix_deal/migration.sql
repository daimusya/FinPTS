-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "bitrixDealId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "projects_bitrixDealId_key" ON "projects"("bitrixDealId");

