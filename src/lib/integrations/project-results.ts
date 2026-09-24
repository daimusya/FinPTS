import crypto from "node:crypto";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { sumMoney, toDecimal } from "@/lib/money";
import { enqueueOutboxEvent } from "./outbox";

export interface ProjectResultDocument {
  direction: "INCOME" | "EXPENSE";
  /** Сумма всего документа (все строки) — для доли проекта в оплатах. */
  total: Decimal;
  /** Сопоставленные оплаты по документу. */
  allocated: Decimal;
  /** Строки документа по этому проекту: сумма и тип статьи ОПиУ. */
  projectLines: Array<{ amount: Decimal; pnlType: string | null }>;
}

export interface ProjectResult {
  revenue: Decimal;
  otherIncome: Decimal;
  directCosts: Decimal;
  otherCosts: Decimal;
  grossProfit: Decimal;
  financialResult: Decimal;
  marginPct: Decimal | null;
  receivedFromCustomers: Decimal;
  receivable: Decimal;
  paidToSuppliers: Decimal;
  payable: Decimal;
  documents: number;
}

const round2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Финансовый результат проекта за всё время по проведённым документам —
 * только то, что отнесено на проект напрямую (строки с этим проектом):
 * выручка и прочие доходы минус прямые и прочие отнесённые расходы. Общие
 * косвенные расходы компании не распределяются — это допущение отчёта
 * «Маржинальность», а не факт по сделке.
 *
 * Денежная часть: оплаты по документу делятся между проектами пропорционально
 * их доле в сумме документа — получено от клиентов / осталось получить,
 * оплачено поставщикам / осталось оплатить.
 */
export function computeProjectResult(documents: ProjectResultDocument[]): ProjectResult {
  let revenue = toDecimal(0);
  let otherIncome = toDecimal(0);
  let directCosts = toDecimal(0);
  let otherCosts = toDecimal(0);
  let receivedFromCustomers = toDecimal(0);
  let receivable = toDecimal(0);
  let paidToSuppliers = toDecimal(0);
  let payable = toDecimal(0);

  for (const doc of documents) {
    const projectAmount = sumMoney(doc.projectLines.map((l) => l.amount));
    if (projectAmount.isZero()) continue;
    for (const line of doc.projectLines) {
      if (line.pnlType === "REVENUE") revenue = revenue.plus(line.amount);
      else if (line.pnlType === "OTHER_INCOME") otherIncome = otherIncome.plus(line.amount);
      else if (line.pnlType === "DIRECT_VARIABLE" || line.pnlType === "DIRECT_FIXED") directCosts = directCosts.plus(line.amount);
      else if (line.pnlType) otherCosts = otherCosts.plus(line.amount);
    }
    const share = doc.total.isZero() ? toDecimal(0) : projectAmount.dividedBy(doc.total);
    const paid = Decimal.min(doc.allocated, doc.total).times(share);
    const outstanding = projectAmount.minus(paid);
    if (doc.direction === "INCOME") {
      receivedFromCustomers = receivedFromCustomers.plus(paid);
      receivable = receivable.plus(outstanding);
    } else {
      paidToSuppliers = paidToSuppliers.plus(paid);
      payable = payable.plus(outstanding);
    }
  }

  const grossProfit = revenue.minus(directCosts);
  const financialResult = revenue.plus(otherIncome).minus(directCosts).minus(otherCosts);
  return {
    revenue,
    otherIncome,
    directCosts,
    otherCosts,
    grossProfit,
    financialResult,
    marginPct: revenue.greaterThan(0) ? round2(financialResult.dividedBy(revenue).times(100)) : null,
    receivedFromCustomers: round2(receivedFromCustomers),
    receivable: round2(receivable),
    paidToSuppliers: round2(paidToSuppliers),
    payable: round2(payable),
    documents: documents.filter((d) => d.projectLines.length > 0).length,
  };
}

export async function loadProjectResult(projectId: string): Promise<ProjectResult> {
  const docs = await prisma.accrualDocument.findMany({
    where: { status: "POSTED", lines: { some: { projectId } } },
    include: {
      lines: { include: { pnlArticle: { select: { type: true } } } },
      allocations: { where: { cancelledAt: null }, select: { amount: true } },
    },
  });
  return computeProjectResult(
    docs.map((d) => ({
      direction: d.direction,
      total: sumMoney(d.lines.map((l) => l.amount)),
      allocated: sumMoney(d.allocations.map((a) => a.amount)),
      projectLines: d.lines
        .filter((l) => l.projectId === projectId)
        .map((l) => ({ amount: toDecimal(l.amount), pnlType: l.pnlArticle?.type ?? null })),
    })),
  );
}

export function projectResultPayload(
  project: { id: string; name: string; code: string | null; bitrixDealId: string },
  result: ProjectResult,
) {
  const money = (d: Decimal) => d.toFixed(2);
  return {
    bitrixDealId: project.bitrixDealId,
    projectId: project.id,
    projectName: project.name,
    projectCode: project.code,
    currency: "RUB",
    revenue: money(result.revenue),
    otherIncome: money(result.otherIncome),
    directCosts: money(result.directCosts),
    otherCosts: money(result.otherCosts),
    grossProfit: money(result.grossProfit),
    financialResult: money(result.financialResult),
    marginPct: result.marginPct ? result.marginPct.toFixed(2) : null,
    receivedFromCustomers: money(result.receivedFromCustomers),
    receivable: money(result.receivable),
    paidToSuppliers: money(result.paidToSuppliers),
    payable: money(result.payable),
    documents: result.documents,
    projectUrl: `/reports/margin?projectId=${project.id}`,
  };
}

/**
 * Ставит в очередь Битрикс24 актуальный финансовый результат проектов,
 * привязанных к сделке. Ключ идемпотентности — хэш цифр результата: пока
 * результат не изменился, повторный вызов новых событий не создаёт.
 * Возвращает, сколько событий поставлено впервые.
 */
export async function enqueueProjectResults(projectIds?: string[]): Promise<{ checked: number; queued: number }> {
  const projects = await prisma.project.findMany({
    where: { bitrixDealId: { not: null }, ...(projectIds ? { id: { in: projectIds } } : {}) },
    select: { id: true, name: true, code: true, bitrixDealId: true },
  });
  let queued = 0;
  for (const project of projects) {
    const payload = projectResultPayload({ ...project, bitrixDealId: project.bitrixDealId! }, await loadProjectResult(project.id));
    // Renaming the project is not a new financial result — only the figures and the deal count.
    const figures = JSON.stringify({ ...payload, projectName: undefined, projectUrl: undefined });
    const digest = crypto.createHash("sha1").update(figures).digest("hex").slice(0, 16);
    const idempotencyKey = `project_result:${project.id}:${digest}`;
    const existed = await prisma.integrationOutbox.findUnique({ where: { idempotencyKey }, select: { id: true } });
    await enqueueOutboxEvent({ eventType: "project_financial_result", targetSystem: "BITRIX24", idempotencyKey, payload });
    if (!existed) queued += 1;
  }
  return { checked: projects.length, queued };
}

/** Проекты, на которые отнесены строки документа, — для пересчёта после его изменения. */
export async function projectIdsOfDocument(documentId: string): Promise<string[]> {
  const lines = await prisma.accrualDocumentLine.findMany({
    where: { documentId, projectId: { not: null } },
    select: { projectId: true },
    distinct: ["projectId"],
  });
  return lines.map((l) => l.projectId!);
}

/** Пересчитать и поставить в очередь результаты проектов документа (если они привязаны к сделкам). */
export async function enqueueProjectResultsForDocument(documentId: string): Promise<void> {
  const ids = await projectIdsOfDocument(documentId);
  if (ids.length > 0) await enqueueProjectResults(ids);
}
