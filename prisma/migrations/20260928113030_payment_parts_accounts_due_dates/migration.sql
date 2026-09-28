-- AlterTable
ALTER TABLE "accrual_documents" ADD COLUMN     "plannedBankAccountId" TEXT,
ADD COLUMN     "plannedCashAccountId" TEXT;

-- AlterTable
ALTER TABLE "payment_request_reschedules" ADD COLUMN     "partId" TEXT;

-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "payBankAccountId" TEXT,
ADD COLUMN     "payCashAccountId" TEXT;

-- CreateTable
CREATE TABLE "payment_request_parts" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_request_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accrual_due_date_changes" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3) NOT NULL,
    "changedById" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accrual_due_date_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_request_parts_paymentRequestId_idx" ON "payment_request_parts"("paymentRequestId");

-- CreateIndex
CREATE INDEX "payment_request_parts_dueDate_idx" ON "payment_request_parts"("dueDate");

-- CreateIndex
CREATE INDEX "accrual_due_date_changes_documentId_idx" ON "accrual_due_date_changes"("documentId");

-- AddForeignKey
ALTER TABLE "accrual_documents" ADD CONSTRAINT "accrual_documents_plannedBankAccountId_fkey" FOREIGN KEY ("plannedBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrual_documents" ADD CONSTRAINT "accrual_documents_plannedCashAccountId_fkey" FOREIGN KEY ("plannedCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payBankAccountId_fkey" FOREIGN KEY ("payBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_payCashAccountId_fkey" FOREIGN KEY ("payCashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_reschedules" ADD CONSTRAINT "payment_request_reschedules_partId_fkey" FOREIGN KEY ("partId") REFERENCES "payment_request_parts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_parts" ADD CONSTRAINT "payment_request_parts_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "payment_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_request_parts" ADD CONSTRAINT "payment_request_parts_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrual_due_date_changes" ADD CONSTRAINT "accrual_due_date_changes_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "accrual_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrual_due_date_changes" ADD CONSTRAINT "accrual_due_date_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
