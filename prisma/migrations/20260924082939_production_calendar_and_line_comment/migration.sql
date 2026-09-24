-- AlterTable
ALTER TABLE "payroll_lines" ADD COLUMN     "comment" TEXT;

-- CreateTable
CREATE TABLE "production_calendar_days" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "production_calendar_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_calendar_days_date_key" ON "production_calendar_days"("date");

-- Production calendar of the Russian Federation, five-day week: only deviations from «Mon–Fri working».
-- Norms that follow from these rows (checked against the official calendar): 2025 — 247 working days
-- (January 17, November 19), 2026 — 247 working days (January 15, May 19). Editable in the dictionary.
INSERT INTO "production_calendar_days" ("id", "date", "kind", "name") VALUES
  ('pcd-2025-01-01', '2025-01-01', 'holiday', 'Новогодние каникулы'),
  ('pcd-2025-01-02', '2025-01-02', 'holiday', 'Новогодние каникулы'),
  ('pcd-2025-01-03', '2025-01-03', 'holiday', 'Новогодние каникулы'),
  ('pcd-2025-01-06', '2025-01-06', 'holiday', 'Новогодние каникулы'),
  ('pcd-2025-01-07', '2025-01-07', 'holiday', 'Рождество Христово'),
  ('pcd-2025-01-08', '2025-01-08', 'holiday', 'Новогодние каникулы'),
  ('pcd-2025-02-24', '2025-02-24', 'holiday', 'Перенос с 23 февраля'),
  ('pcd-2025-03-10', '2025-03-10', 'holiday', 'Перенос с 8 марта'),
  ('pcd-2025-05-01', '2025-05-01', 'holiday', 'Праздник Весны и Труда'),
  ('pcd-2025-05-02', '2025-05-02', 'holiday', 'Перенос с 4 января'),
  ('pcd-2025-05-09', '2025-05-09', 'holiday', 'День Победы'),
  ('pcd-2025-06-12', '2025-06-12', 'holiday', 'День России'),
  ('pcd-2025-11-01', '2025-11-01', 'workday', 'Рабочая суббота (перенос на 3 ноября)'),
  ('pcd-2025-11-03', '2025-11-03', 'holiday', 'Перенос с 1 ноября'),
  ('pcd-2025-11-04', '2025-11-04', 'holiday', 'День народного единства'),
  ('pcd-2025-12-31', '2025-12-31', 'holiday', 'Перенос с 5 января'),
  ('pcd-2026-01-01', '2026-01-01', 'holiday', 'Новогодние каникулы'),
  ('pcd-2026-01-02', '2026-01-02', 'holiday', 'Новогодние каникулы'),
  ('pcd-2026-01-05', '2026-01-05', 'holiday', 'Новогодние каникулы'),
  ('pcd-2026-01-06', '2026-01-06', 'holiday', 'Новогодние каникулы'),
  ('pcd-2026-01-07', '2026-01-07', 'holiday', 'Рождество Христово'),
  ('pcd-2026-01-08', '2026-01-08', 'holiday', 'Новогодние каникулы'),
  ('pcd-2026-01-09', '2026-01-09', 'holiday', 'Перенос с 3 января'),
  ('pcd-2026-02-23', '2026-02-23', 'holiday', 'День защитника Отечества'),
  ('pcd-2026-03-09', '2026-03-09', 'holiday', 'Перенос с 8 марта'),
  ('pcd-2026-05-01', '2026-05-01', 'holiday', 'Праздник Весны и Труда'),
  ('pcd-2026-05-11', '2026-05-11', 'holiday', 'Перенос с 9 мая'),
  ('pcd-2026-06-12', '2026-06-12', 'holiday', 'День России'),
  ('pcd-2026-11-04', '2026-11-04', 'holiday', 'День народного единства'),
  ('pcd-2026-12-31', '2026-12-31', 'holiday', 'Перенос с 4 января')
ON CONFLICT ("date") DO NOTHING;
