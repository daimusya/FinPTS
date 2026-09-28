-- CreateTable
CREATE TABLE "payment_request_reschedules" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_request_reschedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_request_reschedules_paymentRequestId_idx" ON "payment_request_reschedules"("paymentRequestId");

-- AddForeignKey
ALTER TABLE "payment_request_reschedules" ADD CONSTRAINT "payment_request_reschedules_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_reschedules" ADD CONSTRAINT "payment_request_reschedules_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
