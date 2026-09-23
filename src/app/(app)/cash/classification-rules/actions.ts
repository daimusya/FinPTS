"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { classifyTransaction, hasAnyCondition, type ClassificationRuleInput } from "@/lib/bank-import/classification";

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

  const rule = await prisma.bankClassificationRule.create({ data: fields });

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

  const before = await prisma.bankClassificationRule.findUniqueOrThrow({ where: { id } });
  const updated = await prisma.bankClassificationRule.update({ where: { id }, data: { ...fields, isArchived } });

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

  const [rules, transactions] = await Promise.all([
    prisma.bankClassificationRule.findMany({ where: { isArchived: false } }),
    prisma.bankTransaction.findMany({ where: { cashFlowArticleId: null } }),
  ]);

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

  let appliedCount = 0;
  for (const tx of transactions) {
    const result = classifyTransaction(ruleInputs, {
      direction: tx.direction,
      purpose: tx.purpose,
      counterpartyInn: tx.counterpartyInn,
      amount: tx.amount,
    });
    if (!result) continue;

    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: {
        cashFlowArticleId: result.cashFlowArticleId,
        departmentId: result.departmentId ?? tx.departmentId,
        costCenterId: result.costCenterId ?? tx.costCenterId,
        projectId: result.projectId ?? tx.projectId,
        productServiceId: result.productServiceId ?? tx.productServiceId,
      },
    });
    appliedCount += 1;
  }

  if (appliedCount > 0) {
    await logAudit({
      userId: session.userId,
      entityType: "bank_transaction",
      entityId: "bulk",
      action: "auto_classify_bulk",
      after: { appliedCount, scannedCount: transactions.length } as never,
    });
  }

  revalidatePath("/cash/transactions");
  revalidatePath("/cash/classification-rules");
  redirect(`/cash/classification-rules?applied=${appliedCount}`);
}
