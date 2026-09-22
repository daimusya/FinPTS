import { prisma } from "@/lib/db";
import { monthRange } from "@/lib/reports/period";
import { computeManagementBalance } from "@/lib/reports/balance";
import { formatMoney } from "@/lib/money";

export type CheckSeverity = "critical" | "warning";

export interface CloseCheckResult {
  checkType: string;
  label: string;
  severity: CheckSeverity;
  passed: boolean;
  message: string;
}

/**
 * Контрольный лист закрытия периода — раздел 17 ТЗ. Критические проверки
 * блокируют закрытие, предупреждения позволяют закрыть период осознанно
 * (см. вызывающий код в admin/periods/actions.ts).
 */
export async function runPeriodCloseChecklist(year: number, month: number): Promise<CloseCheckResult[]> {
  const { from, to } = monthRange(year, month);
  const results: CloseCheckResult[] = [];

  const unresolvedBatches = await prisma.integrationBatch.count({
    where: { profile: { system: "1C" }, errorCount: { gt: 0 } },
  });
  results.push({
    checkType: "onec_unresolved_batches",
    label: "Необработанные документы 1С",
    severity: "critical",
    passed: unresolvedBatches === 0,
    message:
      unresolvedBatches === 0
        ? "Импортов из 1С с ошибками нет."
        : `Импортов из 1С с необработанными ошибками: ${unresolvedBatches}. Исправьте строки в «1С → Журнал синхронизации» и загрузите файл заново.`,
  });

  const integrationConflicts = await prisma.integrationExternalObject.count({
    where: { status: { in: ["conflict", "error"] } },
  });
  results.push({
    checkType: "integration_conflicts",
    label: "Ошибки и конфликты интеграций",
    severity: "critical",
    passed: integrationConflicts === 0,
    message:
      integrationConflicts === 0
        ? "Конфликтов интеграций нет."
        : `Объектов интеграций в статусе «конфликт»/«ошибка»: ${integrationConflicts}.`,
  });

  const missingAnalytics = await prisma.accrualDocumentLine.count({
    where: {
      pnlArticleId: null,
      document: { status: "POSTED", date: { gte: from, lte: to } },
    },
  });
  results.push({
    checkType: "missing_analytics",
    label: "Документы без обязательной аналитики",
    severity: "critical",
    passed: missingAnalytics === 0,
    message:
      missingAnalytics === 0
        ? "У всех проведённых строк начисления указана статья ОПиУ."
        : `Строк проведённых документов без статьи ОПиУ: ${missingAnalytics}. Отчёты ОПиУ/маржинальность их не учитывают.`,
  });

  const unmatchedTransactions = await prisma.bankTransaction.count({
    where: { operationDate: { gte: from, lte: to }, matchStatus: { not: "MATCHED" } },
  });
  results.push({
    checkType: "unmatched_bank_transactions",
    label: "Несопоставленные банковские операции",
    severity: "warning",
    passed: unmatchedTransactions === 0,
    message:
      unmatchedTransactions === 0
        ? "Все банковские операции периода сопоставлены с начислениями."
        : `Не полностью сопоставленных операций за период: ${unmatchedTransactions}.`,
  });

  const period = await prisma.accountingPeriod.findUnique({ where: { year_month: { year, month } } });
  const incompletePayroll = period
    ? await prisma.payrollRun.count({ where: { periodId: period.id, status: { notIn: ["APPROVED", "PAID"] } } })
    : 0;
  results.push({
    checkType: "incomplete_payroll",
    label: "Незавершённые зарплатные расчёты",
    severity: "critical",
    passed: incompletePayroll === 0,
    message:
      incompletePayroll === 0
        ? "Незавершённых расчётов зарплаты за период нет."
        : `Расчётов зарплаты не в статусе «утверждён»/«выплачен»: ${incompletePayroll}.`,
  });

  const pendingPaymentRequests = await prisma.paymentRequest.count({
    where: { dueDate: { gte: from, lte: to }, status: "PENDING_APPROVAL" },
  });
  results.push({
    checkType: "pending_payment_requests",
    label: "Несогласованные заявки на оплату",
    severity: "warning",
    passed: pendingPaymentRequests === 0,
    message:
      pendingPaymentRequests === 0
        ? "Заявок на согласовании со сроком в этом периоде нет."
        : `Заявок на оплату на согласовании: ${pendingPaymentRequests}.`,
  });

  const balance = await computeManagementBalance(to, {});
  results.push({
    checkType: "balance_discrepancy",
    label: "Расхождения управленческого баланса",
    severity: "warning",
    passed: balance.isBalanced,
    message: balance.isBalanced
      ? "Контрольное равенство баланса выполняется."
      : `Расхождение баланса на конец периода: ${formatMoney(balance.discrepancy)}. Капитал/займы/авансы не выделяются отдельно — см. README.`,
  });

  const unpostedDocuments = await prisma.accrualDocument.count({
    where: { status: "DRAFT", date: { gte: from, lte: to } },
  });
  results.push({
    checkType: "unposted_documents",
    label: "Непроведённые документы начисления",
    severity: "warning",
    passed: unpostedDocuments === 0,
    message:
      unpostedDocuments === 0
        ? "Непроведённых документов начисления за период нет."
        : `Документов в статусе «черновик» за период: ${unpostedDocuments}. Они не попадают в ОПиУ, пока не проведены.`,
  });

  const duplicateFingerprints = await prisma.$queryRaw<Array<{ fingerprint: string; count: bigint }>>`
    SELECT fingerprint, COUNT(*) as count FROM bank_transactions
    WHERE "operationDate" >= ${from} AND "operationDate" <= ${to}
    GROUP BY fingerprint HAVING COUNT(*) > 1
  `;
  results.push({
    checkType: "duplicate_transactions",
    label: "Дубли банковских операций",
    severity: "warning",
    passed: duplicateFingerprints.length === 0,
    message:
      duplicateFingerprints.length === 0
        ? "Дублей не найдено (защита по fingerprint работает на уровне загрузки)."
        : `Найдено дублей по отпечатку: ${duplicateFingerprints.length}. Это не должно происходить — сообщите администратору платформы.`,
  });

  return results;
}
