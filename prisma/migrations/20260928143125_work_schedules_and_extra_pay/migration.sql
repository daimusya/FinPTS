-- AlterTable
ALTER TABLE "work_schedules" ADD COLUMN     "anchorDate" TIMESTAMP(3),
ADD COLUMN     "cycleOff" INTEGER,
ADD COLUMN     "cycleOn" INTEGER,
ADD COLUMN     "hoursPerDay" DECIMAL(4,2) NOT NULL DEFAULT 8,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'five_day';

-- Shortened pre-holiday working days (ст. 95 ТК РФ): with them the 40-hour norm is 1972 hours in 2025 and in 2026.
UPDATE "production_calendar_days" SET "kind" = 'short', "name" = 'Рабочая суббота, сокращённый предпраздничный день (перенос на 3 ноября)' WHERE "date" = '2025-11-01';
INSERT INTO "production_calendar_days" ("id", "date", "kind", "name") VALUES
  ('pcd-2025-03-07', '2025-03-07', 'short', 'Сокращённый предпраздничный день'),
  ('pcd-2025-04-30', '2025-04-30', 'short', 'Сокращённый предпраздничный день'),
  ('pcd-2025-06-11', '2025-06-11', 'short', 'Сокращённый предпраздничный день'),
  ('pcd-2026-04-30', '2026-04-30', 'short', 'Сокращённый предпраздничный день'),
  ('pcd-2026-05-08', '2026-05-08', 'short', 'Сокращённый предпраздничный день'),
  ('pcd-2026-06-11', '2026-06-11', 'short', 'Сокращённый предпраздничный день'),
  ('pcd-2026-11-03', '2026-11-03', 'short', 'Сокращённый предпраздничный день')
ON CONFLICT ("date") DO NOTHING;

-- Accrual types for overtime, work on days off and business trips; posted to the same P&L article as the salary.
INSERT INTO "payroll_accrual_types" ("id", "name", "code", "subjectToNdfl", "subjectToInsurance", "affectsAvgEarnings", "paymentMethod", "pnlArticleId")
SELECT v.id, v.name, v.code, true, true, v.avg, 'BANK', (SELECT "pnlArticleId" FROM "payroll_accrual_types" WHERE "code" = 'salary')
FROM (VALUES
  ('pat-overtime-pay', 'Сверхурочные', 'overtime_pay', true),
  ('pat-weekend-pay', 'Работа в выходные и праздники', 'weekend_pay', true),
  ('pat-business-trip-pay', 'Командировка (средний заработок)', 'business_trip_pay', false)
) AS v(id, name, code, avg)
ON CONFLICT ("code") DO NOTHING;
