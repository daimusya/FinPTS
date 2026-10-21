import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RUN_NOT_EDITABLE, runLinesEditable } from "@/lib/payroll/run-month";

/** Расчёт уже утверждён (выплачен) или удалён — строки менять нельзя. */
export class RunNotEditableError extends Error {
  constructor() {
    super(RUN_NOT_EDITABLE);
  }
}

/**
 * Изменить строки расчёта зарплаты под блокировкой его записи: статус
 * проверяется внутри той же транзакции, поэтому два одновременных пересчёта
 * не задваивают строки (второй ждёт первого и заменяет его строки целиком),
 * а утверждение, начатое во время пересчёта, дожидается его конца и проводит
 * уже полный набор строк. Утверждённый тем временем расчёт не меняется.
 */
export async function withEditableRun<T>(runId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ status: string }>>`SELECT "status"::text AS status FROM "payroll_runs" WHERE "id" = ${runId} FOR UPDATE`;
      if (!rows[0] || !runLinesEditable(rows[0].status)) throw new RunNotEditableError();
      return fn(tx);
    },
    { maxWait: 30_000, timeout: 120_000 },
  );
}
