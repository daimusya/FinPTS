-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "emailSentAt" TIMESTAMP(3),
ADD COLUMN     "telegramSentAt" TIMESTAMP(3);
