-- CreateTable
CREATE TABLE "login_failures" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_failures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_failures_email_createdAt_idx" ON "login_failures"("email", "createdAt");
