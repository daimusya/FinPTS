import Decimal from "decimal.js";
import { toDecimal, type MoneyInput } from "@/lib/money";
import { prisma } from "@/lib/db";
import { AccrualDocumentStatus } from "@prisma/client";
import { enqueueProjectResultsForDocument } from "@/lib/integrations/project-results";

export interface PayrollLineForPosting {
  pnlArticleId: string | null;
  departmentId: string | null;
  projectId: string | null;
  employeeName: string;
  accrualTypeName: string;
  amount: MoneyInput;
  insuranceAmount: MoneyInput;
}

export interface AccrualLineDraft {
  pnlArticleId: string;
  departmentId: string | null;
  projectId: string | null;
  amount: Decimal;
  description: string;
}

/**
 * Строит строки документа начисления (расход) из строк расчёта зарплаты.
 * Одна строка расчёта -> одна строка документа: сумма = начислено +
 * страховые взносы (оба — реальные затраты компании на этого сотрудника
 * по этому виду начисления). Взносы относятся на ту же статью ОПиУ, что
 * и само начисление — отдельной статьи «страховые взносы» в этой версии
 * нет (сознательное упрощение, см. README). Строки без статьи ОПиУ у вида
 * начисления пропускаются — по ним начисление остаётся ручным, как и
 * раньше.
 */
export function buildPayrollAccrualLines(lines: PayrollLineForPosting[]): AccrualLineDraft[] {
  const drafts: AccrualLineDraft[] = [];
  for (const line of lines) {
    if (!line.pnlArticleId) continue;
    const amount = toDecimal(line.amount).plus(toDecimal(line.insuranceAmount));
    if (amount.lessThanOrEqualTo(0)) continue;
    drafts.push({
      pnlArticleId: line.pnlArticleId,
      departmentId: line.departmentId,
      projectId: line.projectId,
      amount,
      description: `${line.employeeName} — ${line.accrualTypeName}`,
    });
  }
  return drafts;
}

const PAYROLL_COUNTERPARTY_NAME = "Сотрудники (ФОТ)";

/**
 * У документа начисления обязателен контрагент, а сотрудники — не
 * контрагенты. Заводим единственную синтетическую запись-«клиринг» на всю
 * систему (не привязана к организации, как и остальные контрагенты) и
 * переиспользуем её для всех расчётов зарплаты всех организаций.
 */
async function getOrCreatePayrollCounterpartyId(): Promise<string> {
  const existing = await prisma.counterparty.findFirst({ where: { fullName: PAYROLL_COUNTERPARTY_NAME } });
  if (existing) return existing.id;
  const created = await prisma.counterparty.create({
    data: { fullName: PAYROLL_COUNTERPARTY_NAME, dataSource: "payroll-system" },
  });
  return created.id;
}

/**
 * Проводит утверждённый расчёт зарплаты в ОПиУ: создаёт один документ
 * начисления (расход, статус «Проведён») со строками из
 * buildPayrollAccrualLines. Идемпотентно — привязка к расчёту через
 * (sourceSystem, externalId), повторный вызов для того же расчёта ничего
 * не создаст повторно. Если ни одна строка расчёта не привязана к статье
 * ОПиУ, документ не создаётся вовсе (нечего проводить).
 */
export async function postPayrollRunToAccrual(payrollRunId: string): Promise<string | null> {
  const existing = await prisma.accrualDocument.findUnique({
    where: { sourceSystem_externalId: { sourceSystem: "payroll", externalId: payrollRunId } },
  });
  if (existing) return existing.id;

  const run = await prisma.payrollRun.findUniqueOrThrow({
    where: { id: payrollRunId },
    include: { lines: { include: { employee: true, accrualType: true } } },
  });

  const drafts = buildPayrollAccrualLines(
    run.lines.map((l) => ({
      pnlArticleId: l.accrualType.pnlArticleId,
      departmentId: l.departmentId,
      projectId: l.projectId,
      employeeName: l.employee.fullName,
      accrualTypeName: l.accrualType.name,
      amount: l.amount,
      insuranceAmount: l.insuranceAmount,
    })),
  );
  if (drafts.length === 0) return null;

  const counterpartyId = await getOrCreatePayrollCounterpartyId();
  const number = `ФОТ-${run.payoutDate.toISOString().slice(0, 7)}-${run.id.slice(-6)}`;

  const document = await prisma.accrualDocument.create({
    data: {
      organizationId: run.organizationId,
      counterpartyId,
      number,
      date: run.payoutDate,
      documentType: "MANUAL",
      direction: "EXPENSE",
      status: AccrualDocumentStatus.POSTED,
      periodId: run.periodId,
      sourceSystem: "payroll",
      externalId: run.id,
      comment: "Автоматически создано при утверждении расчёта зарплаты",
      lines: {
        create: drafts.map((d) => ({
          pnlArticleId: d.pnlArticleId,
          departmentId: d.departmentId,
          projectId: d.projectId,
          amount: d.amount,
          description: d.description,
        })),
      },
    },
  });

  await enqueueProjectResultsForDocument(document.id);
  return document.id;
}
