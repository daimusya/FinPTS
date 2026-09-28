-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "priorInsuranceMonths" INTEGER;

-- AlterTable
ALTER TABLE "employment_history" ADD COLUMN     "fromSalary" DECIMAL(18,2),
ADD COLUMN     "toSalary" DECIMAL(18,2);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "districtCoefficient" DECIMAL(5,3);

-- AlterTable
ALTER TABLE "payroll_accrual_types" ADD COLUMN     "indexable" BOOLEAN NOT NULL DEFAULT false;

-- Salary and advance depend on the salary: they are indexed in the average earnings when salaries are raised.
UPDATE "payroll_accrual_types" SET "indexable" = true WHERE "code" IN ('salary', 'advance');
