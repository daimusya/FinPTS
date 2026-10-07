"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { classifyTransaction, hasAnyCondition, type ClassificationRuleInput } from "@/lib/bank-import/classification";
import { ruleConditionsProblem } from "@/lib/bank-import/rule-form";
import { bankTransactionScopeWhere, getAccessScope } from "@/lib/access-scope";
import { PeriodStatus } from "@prisma/client";

function readRuleForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const priority = Number(formData.get("priority") ?? 100) || 100;
  const direction = String(formData.get("direction") ?? "") || null;
  const purposeContains = String(formData.get("purposeContains") ?? "").trim() || null;
  const counterpartyInn = String(formData.get("counterpartyInn") ?? "").trim() || null;
  const amountEqualsRaw = String(formData.get("amountEquals") ?? "").trim();
  const amountEquals = amountEqualsRaw ? amountEqualsRaw : null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const costCenterId = String(formData.get("costCenterId") ?? "") || null;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const productServiceId = String(formData.get("productServiceId") ?? "") || null;
  return {
    name,
    priority,
    direction: direction as "INFLOW" | "OUTFLOW" | null,
    purposeContains,
    counterpartyInn,
    amountEquals,
    cashFlowArticleId,
    departmentId,
    costCenterId,
    projectId,
    productServiceId,
  };
}

export async function createRuleAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const fields = readRuleForm(formData);

  if (!fields.name) {
    redirect(`/cash/classification-rules/new?error=${encodeURIComponent("Укажите название правила")}`);
  }
  if (!hasAnyCondition(fields)) {
    redirect(
      `/cash/classification-rules/new?error=${encodeURIComponent("Укажите хотя бы одно условие: назначение платежа, ИНН контрагента или сумму")}`,
    );
  }
  if (!fields.cashFlowArticleId) {
    redirect(`/cash/classification-rules/new?error=${encodeURIComponent("Выберите статью ДДС, которая будет назначена")}`);
  }
  const checked = ruleConditionsProblem(fields);
  if ("error" in checked) redirect(`/cash/classification-rules/new?error=${encodeURIComponent(checked.error)}`);

  const rule = await prisma.bankClassificationRule.create({ data: { ...fields, ...(checked as { amountEquals: string | null; counterpartyInn: string | null }) } });

  await logAudit({
    userId: session.userId,
    entityType: "bank_classification_rule",
    entityId: rule.id,
    action: "create",
    after: rule as never,
  });

  revalidatePath("/cash/classification-rules");
  redirect("/cash/classification-rules");
}

export async function updateRuleAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const fields = readRuleForm(formData);
  const isArchived = formData.get("isArchived") === "on";

  if (!fields.name) {
    redirect(`/cash/classification-rules/${id}/edit?error=${encodeURIComponent("Укажите название правила")}`);
  }
  if (!hasAnyCondition(fields)) {
    redirect(
      `/cash/classification-rules/${id}/edit?error=${encodeURIComponent("Укажите хотя бы одно условие: назначение платежа, ИНН контрагента или сумму")}`,
    );
  }
  if (!fields.cashFlowArticleId) {
    redirect(`/cash/classification-rules/${id}/edit?error=${encodeURIComponent("Выберите статью ДДС, которая будет назначена")}`);
  }
  const checked = ruleConditionsProblem(fields);
  if ("error" in checked) redirect(`/cash/classification-rules/${id}/edit?error=${encodeURIComponent(checked.error)}`);

  const before = await prisma.bankClassificationRule.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.bankClassificationRule.update({
    where: { id },
    data: { ...fields, ...(checked as { amountEquals: string | null; counterpartyInn: string | null }), isArchived },
  });

  await logAudit({
    userId: session.userId,
    entityType: "bank_classification_rule",
    entityId: id,
    action: "update",
    before: before as never,
    after: updated as never,
  });

  revalidatePath("/cash/classification-rules");
  redirect("/cash/classification-rules");
}

/**
 * Применяет активные правила ко всем уже импортированным операциям без
 * назначенной статьи ДДС (не трогает операции, классифицированные вручную
 * или предыдущим применением правил, — cashFlowArticleId уже не пуст).
 */
export async function applyRulesToUnclassifiedAction() {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  // Only operations the user may see, outside closed months, and not transfers between own accounts (they need no article).
  const scope = await getAccessScope(session);
  const closed = await prisma.accountingPeriod.findMany({ where: { status: PeriodStatus.CLOSED }, select: { year: true, month: true } });
  const closedKeys = new Set(closed.map((p) => `${p.year}-${p.month}`));
  const [rules, candidates] = await Promise.all([
    prisma.bankClassificationRule.findMany({ where: { isArchived: false } }),
    prisma.bankTransaction.findMany({ where: { cashFlowArticleId: null, isTransfer: false, ...bankTransactionScopeWhere(scope) } }),
  ]);
  const transactions = candidates.filter((tx) => !closedKeys.has(`${tx.operationDate.getUTCFullYear()}-${tx.operationDate.getUTCMonth() + 1}`));
  const skippedClosed = candidates.length - transactions.length;

  const ruleInputs: ClassificationRuleInput[] = rules.map((r) => ({
    id: r.id,
    priority: r.priority,
    direction: r.direction,
    purposeContains: r.purposeContains,
    counterpartyInn: r.counterpartyInn,
    amountEquals: r.amountEquals,
    cashFlowArticleId: r.cashFlowArticleId,
    departmentId: r.departmentId,
    costCenterId: r.costCenterId,
    projectId: r.projectId,
    productServiceId: r.productServiceId,
  }));

  // Operations getting the same values are updated together: a rule's empty dimension keeps the operation's own.
  const groups = new Map<string, { data: Record<string, string>; ids: string[] }>();
  for (const tx of transactions) {
    const result = classifyTransaction(ruleInputs, {
      direction: tx.direction,
      purpose: tx.purpose,
      counterpartyInn: tx.counterpartyInn,
      amount: tx.amount,
    });
    if (!result?.cashFlowArticleId) continue;
    const data: Record<string, string> = { cashFlowArticleId: result.cashFlowArticleId };
    for (const key of ["departmentId", "costCenterId", "projectId", "productServiceId"] as const) if (result[key]) data[key] = result[key]!;
    const groupKey = JSON.stringify(data);
    const group = groups.get(groupKey) ?? { data, ids: [] };
    group.ids.push(tx.id);
    groups.set(groupKey, group);
  }
  // cashFlowArticleId: null in the condition — an operation classified meanwhile by someone else is left alone.
  const updates = await prisma.$transaction(
    [...groups.values()].map((g) => prisma.bankTransaction.updateMany({ where: { id: { in: g.ids }, cashFlowArticleId: null }, data: g.data })),
  );
  const appliedCount = updates.reduce((sum, u) => sum + u.count, 0);

  if (appliedCount > 0) {
    await logAudit({
      userId: session.userId,
      entityType: "bank_transaction",
      entityId: "bulk",
      action: "auto_classify_bulk",
      after: { appliedCount, scannedCount: transactions.length, skippedClosed } as never,
    });
  }

  revalidatePath("/cash/transactions");
  revalidatePath("/cash/classification-rules");
  redirect(`/cash/classification-rules?applied=${appliedCount}`);
}
