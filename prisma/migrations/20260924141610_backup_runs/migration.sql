-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "tableCount" INTEGER,
    "restoreCheck" TEXT,
    "restoreDetails" TEXT,
    "deletedOld" INTEGER,
    "error" TEXT,
    "host" TEXT,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_runs_startedAt_idx" ON "backup_runs"("startedAt");
