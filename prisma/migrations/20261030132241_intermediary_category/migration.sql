-- CreateEnum
CREATE TYPE "IntermediaryCategory" AS ENUM ('VIP', 'STANDARD');

-- AlterTable
ALTER TABLE "intermediaries" ADD COLUMN     "category" "IntermediaryCategory" NOT NULL DEFAULT 'VIP';
