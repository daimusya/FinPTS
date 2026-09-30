-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryError" TEXT,
ADD COLUMN     "deliveryState" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notifyTelegram" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "telegramChatId" TEXT,
ADD COLUMN     "telegramLinkCode" TEXT;

-- CreateIndex
CREATE INDEX "notifications_deliveryState_idx" ON "notifications"("deliveryState");
