-- AlterTable
ALTER TABLE "accrual_documents" ADD COLUMN     "dueTime" VARCHAR(5);

-- AlterTable
ALTER TABLE "accrual_due_date_changes" ADD COLUMN     "fromTime" VARCHAR(5),
ADD COLUMN     "toTime" VARCHAR(5);

-- AlterTable
ALTER TABLE "payment_request_parts" ADD COLUMN     "dueTime" VARCHAR(5);

-- AlterTable
ALTER TABLE "payment_request_reschedules" ADD COLUMN     "fromTime" VARCHAR(5),
ADD COLUMN     "toTime" VARCHAR(5);

-- AlterTable
ALTER TABLE "payment_requests" ADD COLUMN     "dueTime" VARCHAR(5);
