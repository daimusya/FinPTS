-- AddForeignKey
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_fromDepartmentId_fkey" FOREIGN KEY ("fromDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_fromPositionId_fkey" FOREIGN KEY ("fromPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment_history" ADD CONSTRAINT "employment_history_toPositionId_fkey" FOREIGN KEY ("toPositionId") REFERENCES "positions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
