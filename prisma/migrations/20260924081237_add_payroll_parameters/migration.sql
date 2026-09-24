-- CreateTable
CREATE TABLE "payroll_parameters" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "payroll_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_parameters_code_year_key" ON "payroll_parameters"("code", "year");

-- Known values at the time of writing. Both are editable in the «Параметры расчёта зарплаты» dictionary;
-- add next year's values there once they are officially set.
-- Предельная база для взносов на ОСС (ВНиМ): 2021–2022; единая предельная база: 2023–2026.
INSERT INTO "payroll_parameters" ("id", "code", "year", "value") VALUES
  ('pp-insurance-base-limit-2021', 'insurance_base_limit', 2021, 966000),
  ('pp-insurance-base-limit-2022', 'insurance_base_limit', 2022, 1032000),
  ('pp-insurance-base-limit-2023', 'insurance_base_limit', 2023, 1917000),
  ('pp-insurance-base-limit-2024', 'insurance_base_limit', 2024, 2225000),
  ('pp-insurance-base-limit-2025', 'insurance_base_limit', 2025, 2759000),
  ('pp-insurance-base-limit-2026', 'insurance_base_limit', 2026, 2979000),
  ('pp-mrot-2023', 'mrot', 2023, 16242),
  ('pp-mrot-2024', 'mrot', 2024, 19242),
  ('pp-mrot-2025', 'mrot', 2025, 22440),
  ('pp-mrot-2026', 'mrot', 2026, 27093)
ON CONFLICT ("code", "year") DO NOTHING;
