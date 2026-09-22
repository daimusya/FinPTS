-- AlterTable
ALTER TABLE "accounting_periods" ADD COLUMN     "closingSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "accrual_documents_status_paymentStatus_idx" ON "accrual_documents"("status", "paymentStatus");

-- CreateIndex
CREATE INDEX "bank_transactions_matchStatus_idx" ON "bank_transactions"("matchStatus");

-- CreateIndex
CREATE INDEX "payment_requests_dueDate_idx" ON "payment_requests"("dueDate");

-- CreateIndex
CREATE INDEX "payment_requests_status_idx" ON "payment_requests"("status");

-- CreateIndex
CREATE INDEX "payroll_runs_payoutDate_idx" ON "payroll_runs"("payoutDate");
