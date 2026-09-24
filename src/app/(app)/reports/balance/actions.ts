"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { assertPeriodOpenForDate } from "@/lib/period";
import { getAccessScope } from "@/lib/access-scope";
import { acceptsManualEntries } from "@/lib/reports/balance-lines";
import { toDecimal } from "@/lib/money";

function balanceUrl(formData: FormData, error?: string) {
  const params = new URLSearchParams();
  for (const key of ["asOf", "organizationId"]) {
    const value = String(formData.get(`back_${key}`) ?? "");
    if (value) params.set(key, value);
  }
  if (error) params.set("error", error);
  const query = params.toString();
  return `/reports/balance${query ? `?${query}` : ""}`;
}

/**
 * Балансовая операция — ручное изменение остатка статьи баланса с даты:
 * ввод остатков на начало учёта, корректировки. Сумма со знаком: «+»
 * увеличивает остаток статьи, «−» уменьшает.
 */
export async function addBalanceEntryAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.ACCRUALS_MANAGE);
  const back = (message: string): never => redirect(balanceUrl(formData, message));

  const dateRaw = String(formData.get("date") ?? "");
  const balanceArticleId = String(formData.get("balanceArticleId") ?? "");
  const organizationId = String(formData.get("organizationId") ?? "") || null;
  const amountRaw = String(formData.get("amount") ?? "").replace(/[\s ]/g, "").replace(",", ".");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) back("Укажите дату операции");
  if (!/^-?\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) === 0) {
    back("Сумма — ненулевое число, со знаком «−» для уменьшения остатка");
  }
  const article = await prisma.balanceArticle.findUnique({ where: { id: balanceArticleId } });
  if (!article || article.isArchived) back("Выберите статью баланса");
  if (!acceptsManualEntries(article!.systemCode)) {
    back(`«${article!.name}» считается из операций — вводить по ней остатки нельзя`);
  }

  const scope = await getAccessScope(session);
  if (scope.organizationIds !== null && (!organizationId || !scope.organizationIds.includes(organizationId))) {
    back("Выберите организацию, к данным которой у вас есть доступ");
  }

  const date = new Date(`${dateRaw}T00:00:00.000Z`);
  try {
    await assertPeriodOpenForDate(date);
  } catch (e) {
    back((e as Error).message);
  }

  const entry = await prisma.balanceEntry.create({
    data: {
      date,
      balanceArticleId,
      organizationId,
      amount: toDecimal(amountRaw).toFixed(2),
      comment,
      createdById: session.userId,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "balance_entry",
    entityId: entry.id,
    action: "create",
    after: entry as never,
  });

  revalidatePath("/reports/balance");
  redirect(balanceUrl(formData));
}

export async function deleteBalanceEntryAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.ACCRUALS_MANAGE);

  const entry = await prisma.balanceEntry.findUnique({ where: { id } });
  if (!entry) redirect(balanceUrl(formData));
  const scope = await getAccessScope(session);
  if (scope.organizationIds !== null && (!entry!.organizationId || !scope.organizationIds.includes(entry!.organizationId))) {
    redirect(balanceUrl(formData, "Нет доступа к этой операции"));
  }
  try {
    await assertPeriodOpenForDate(entry!.date);
  } catch (e) {
    redirect(balanceUrl(formData, (e as Error).message));
  }

  await prisma.balanceEntry.delete({ where: { id } });
  await logAudit({
    userId: session.userId,
    entityType: "balance_entry",
    entityId: id,
    action: "delete",
    before: entry as never,
  });

  revalidatePath("/reports/balance");
  redirect(balanceUrl(formData));
}
