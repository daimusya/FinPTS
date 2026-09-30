-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "dataSource" TEXT,
ADD COLUMN     "dataUpdatedAt" TIMESTAMP(3);
