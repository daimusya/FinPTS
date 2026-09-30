"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { assertPeriodOpenForDate } from "@/lib/period";
import { recomputeAccrualDocumentStatus, recomputeBankTransactionStatus } from "@/lib/matching";
import { formatMoney, sumMoney, toDecimal } from "@/lib/money";
import { PERMISSIONS } from "@/lib/permissions";
import { computeFingerprint } from "@/lib/bank-import/fingerprint";
import { oppositeDirection, resolveTransferAmounts, validateTransferAccounts } from "@/lib/cash/transfer";
import {
  checkTransactionDeletion,
  deletedByBatch,
  planBulkDeletion,
  checkTransactionEdit,
  parseTransactionEdit,
  type TransactionEditInput,
} from "@/lib/cash/transaction-edit";
import { bankTransactionScopeWhere, getAccessScope } from "@/lib/access-scope";
import type { Prisma } from "@prisma/client";
import { allocationTransactionSide, planAllocation, type AllocationAmounts } from "@/lib/accruals/currency";
import { normalizeCurrency } from "@/lib/currency";
import { loadRateLookup } from "@/lib/currency-rates";
import crypto from "node:crypto";

export async function createBankTransactionAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const bankAccountId = String(formData.get("bankAccountId") ?? "") || null;
  const cashAccountId = String(formData.get("cashAccountId") ?? "") || null;
  const operationDateRaw = String(formData.get("operationDate") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  const purpose = String(formData.get("purpose") ?? "").trim() || null;
  const counterpartyId = String(formData.get("counterpartyId") ?? "") || null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const costCenterId = String(formData.get("costCenterId") ?? "") || null;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const productServiceId = String(formData.get("productServiceId") ?? "") || null;
  const isTransfer = formData.get("isTransfer") === "on";
  const secondBankAccountId = String(formData.get("secondBankAccountId") ?? "") || null;
  const secondCashAccountId = String(formData.get("secondCashAccountId") ?? "") || null;

  if ((!bankAccountId && !cashAccountId) || (bankAccountId && cashAccountId)) {
    redirect(`/cash/transactions/new?error=${encodeURIComponent("Выберите либо банковский счёт, либо кассу")}`);
  }
  if (!operationDateRaw || !direction || !amountRaw || Number(amountRaw) <= 0) {
    redirect(`/cash/transactions/new?error=${encodeURIComponent("Заполните дату, направление и сумму")}`);
  }
  // A transfer between accounts in different currencies (buying or selling currency) has its own amount on each leg.
  let secondAmount = amountRaw;
  let dealRate: string | null = null;
  if (isTransfer) {
    const validationError = validateTransferAccounts(
      { bankAccountId, cashAccountId },
      { bankAccountId: secondBankAccountId, cashAccountId: secondCashAccountId },
    );
    if (validationError) {
      redirect(`/cash/transactions/new?error=${encodeURIComponent(validationError)}`);
    }
    const amounts = resolveTransferAmounts({
      amount: amountRaw,
      secondAmount: String(formData.get("secondAmount") ?? ""),
      currency: await accountCurrency(bankAccountId, cashAccountId),
      secondCurrency: await accountCurrency(secondBankAccountId, secondCashAccountId),
    });
    if ("error" in amounts) redirect(`/cash/transactions/new?error=${encodeURIComponent(amounts.error)}`);
    secondAmount = (amounts as { second: string }).second;
    dealRate = (amounts as { dealRate: string | null }).dealRate;
  }

  const operationDate = new Date(operationDateRaw);
  await assertPeriodOpenForDate(operationDate).catch((e) => {
    redirect(`/cash/transactions/new?error=${encodeURIComponent((e as Error).message)}`);
  });

  const fingerprint = computeFingerprint({
    bankAccountId: bankAccountId ?? cashAccountId ?? "manual",
    operationDate,
    direction: direction as "INFLOW" | "OUTFLOW",
    amount: toDecimal(amountRaw).toFixed(2),
    purpose,
  });

  const existing = await prisma.bankTransaction.findUnique({ where: { fingerprint } });
  if (existing) {
    redirect(`/cash/transactions/new?error=${encodeURIComponent("Такая операция уже существует (защита от повторного ввода)")}`);
  }

  if (isTransfer) {
    const secondDirection = oppositeDirection(direction as "INFLOW" | "OUTFLOW");
    const secondFingerprint = computeFingerprint({
      bankAccountId: secondBankAccountId ?? secondCashAccountId ?? "manual",
      operationDate,
      direction: secondDirection,
      amount: toDecimal(secondAmount).toFixed(2),
      purpose,
    });
    const secondExisting = await prisma.bankTransaction.findUnique({ where: { fingerprint: secondFingerprint } });
    if (secondExisting) {
      redirect(`/cash/transactions/new?error=${encodeURIComponent("Встречная операция перевода уже существует (защита от повторного ввода)")}`);
    }

    const transferGroupId = crypto.randomUUID();
    const [created, secondLeg] = await prisma.$transaction([
      prisma.bankTransaction.create({
        data: {
          bankAccountId,
          cashAccountId,
          operationDate,
          direction: direction as never,
          amount: amountRaw,
          purpose,
          counterpartyId,
          cashFlowArticleId,
          departmentId,
          costCenterId,
          projectId,
          productServiceId,
          isTransfer,
          transferGroupId,
          fingerprint,
        },
      }),
      prisma.bankTransaction.create({
        data: {
          bankAccountId: secondBankAccountId,
          cashAccountId: secondCashAccountId,
          operationDate,
          direction: secondDirection as never,
          amount: secondAmount,
          purpose,
          counterpartyId,
          cashFlowArticleId,
          departmentId,
          costCenterId,
          projectId,
          productServiceId,
          isTransfer,
          transferGroupId,
          fingerprint: secondFingerprint,
        },
      }),
    ]);

    await Promise.all([
      logAudit({
        userId: session.userId,
        entityType: "bank_transaction",
        entityId: created.id,
        action: "create_manual_transfer",
        after: created as never,
      }),
      logAudit({
        userId: session.userId,
        entityType: "bank_transaction",
        entityId: secondLeg.id,
        action: "create_manual_transfer",
        after: { ...secondLeg, dealRate } as never,
      }),
    ]);

    revalidatePath("/cash/transactions");
    redirect(`/cash/transactions/${created.id}`);
  }

  const created = await prisma.bankTransaction.create({
    data: {
      bankAccountId,
      cashAccountId,
      operationDate,
      direction: direction as never,
      amount: amountRaw,
      purpose,
      counterpartyId,
      cashFlowArticleId,
      departmentId,
      costCenterId,
      projectId,
      productServiceId,
      isTransfer,
      fingerprint,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "bank_transaction",
    entityId: created.id,
    action: "create_manual",
    after: created as never,
  });

  revalidatePath("/cash/transactions");
  redirect(`/cash/transactions/${created.id}`);
}

type Session = Awaited<ReturnType<typeof requirePermission>>;

/**
 * Операция в зоне видимости пользователя и вторая нога перевода, если это
 * перевод между собственными счетами. Действующие сопоставления — для проверок.
 */
async function loadTransactionWithPair(session: Session, id: string) {
  const scope = await getAccessScope(session);
  const include = { allocations: { where: { cancelledAt: null } } } as const;
  const tx = await prisma.bankTransaction.findFirst({ where: { id, ...bankTransactionScopeWhere(scope) }, include });
  if (!tx) redirect("/cash/transactions");
  const found = tx!;
  const pair = found.transferGroupId
    ? await prisma.bankTransaction.findFirst({ where: { transferGroupId: found.transferGroupId, id: { not: found.id } }, include })
    : null;
  return { tx: found, pair };
}

const allocatedSum = (leg: { allocations: Array<{ amount: Prisma.Decimal; transactionAmount: Prisma.Decimal | null }> }) =>
  sumMoney(leg.allocations.map(allocationTransactionSide)).toFixed(2);

const toEditableLeg = (leg: NonNullable<Awaited<ReturnType<typeof loadTransactionWithPair>>["pair"]>) => ({
  direction: leg.direction,
  isImported: Boolean(leg.batchId),
  allocated: allocatedSum(leg),
  bankAccountId: leg.bankAccountId,
  cashAccountId: leg.cashAccountId,
});

export async function updateTransactionClassificationAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const back = (message: string): never => redirect(`/cash/transactions/${id}?error=${encodeURIComponent(message)}`);

  const { tx: before, pair } = await loadTransactionWithPair(session, id);
  await assertPeriodOpenForDate(before.operationDate).catch((e) => back((e as Error).message));

  const counterpartyId = String(formData.get("counterpartyId") ?? "") || null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const departmentId = String(formData.get("departmentId") ?? "") || null;
  const costCenterId = String(formData.get("costCenterId") ?? "") || null;
  const projectId = String(formData.get("projectId") ?? "") || null;
  const productServiceId = String(formData.get("productServiceId") ?? "") || null;
  // A leg of a paired transfer stays a transfer: unticking it would leave the other leg alone.
  const isTransfer = pair ? true : formData.get("isTransfer") === "on";

  const data = { counterpartyId, cashFlowArticleId, departmentId, costCenterId, projectId, productServiceId, isTransfer };
  // Both legs of a transfer carry the same classification, as when they were created.
  const [updated, updatedPair] = await prisma.$transaction([
    prisma.bankTransaction.update({ where: { id }, data }),
    ...(pair ? [prisma.bankTransaction.update({ where: { id: pair.id }, data })] : []),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "bank_transaction",
    entityId: id,
    action: "classify",
    before: before as never,
    after: updated as never,
  });
  if (pair && updatedPair) {
    await logAudit({
      userId: session.userId,
      entityType: "bank_transaction",
      entityId: pair.id,
      action: "classify_transfer_pair",
      before: pair as never,
      after: updatedPair as never,
    });
  }

  revalidatePath("/cash/transactions");
  revalidatePath(`/cash/transactions/${id}`);
  if (pair) revalidatePath(`/cash/transactions/${pair.id}`);
  redirect(`/cash/transactions/${id}`);
}

/** Валюта банковского счёта или кассы. */
async function accountCurrency(bankAccountId: string | null, cashAccountId: string | null): Promise<string> {
  if (bankAccountId) return normalizeCurrency((await prisma.bankAccount.findUnique({ where: { id: bankAccountId } }))?.currency);
  if (cashAccountId) return normalizeCurrency((await prisma.cashAccount.findUnique({ where: { id: cashAccountId } }))?.currency);
  return "RUB";
}

/**
 * Исправление даты, суммы, направления, назначения и счёта ручной операции.
 * У перевода между собственными счетами вторая нога меняется вместе с первой.
 */
export async function updateBankTransactionAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const back = (message: string): never => redirect(`/cash/transactions/${id}?error=${encodeURIComponent(message)}`);

  const { tx, pair } = await loadTransactionWithPair(session, id);
  const parsed = parseTransactionEdit((name) => formData.get(name));
  if ("error" in parsed) back(parsed.error);
  const next = parsed as TransactionEditInput;
  // The other leg of a transfer between currencies keeps its own amount (from the form), otherwise the same.
  let pairAmount = next.amount;
  if (pair) {
    const amounts = resolveTransferAmounts({
      amount: next.amount,
      secondAmount: String(formData.get("pairAmount") ?? ""),
      currency: await accountCurrency(next.bankAccountId, next.cashAccountId),
      secondCurrency: await accountCurrency(pair.bankAccountId, pair.cashAccountId),
    });
    if ("error" in amounts) back(amounts.error);
    pairAmount = (amounts as { second: string }).second;
  }
  const problem = checkTransactionEdit(toEditableLeg(tx), next, pair ? toEditableLeg(pair) : null, pairAmount);
  if (problem) back(problem);

  // Both the old and the new month must be open: the operation leaves one and enters the other.
  for (const date of [tx.operationDate, next.operationDate]) {
    await assertPeriodOpenForDate(date).catch((e) => back((e as Error).message));
  }

  const pairDirection = oppositeDirection(next.direction);
  const fingerprint = computeFingerprint({
    bankAccountId: next.bankAccountId ?? next.cashAccountId ?? "manual",
    operationDate: next.operationDate,
    direction: next.direction,
    amount: next.amount,
    purpose: next.purpose,
  });
  const pairFingerprint = pair
    ? computeFingerprint({
        bankAccountId: pair.bankAccountId ?? pair.cashAccountId ?? "manual",
        operationDate: next.operationDate,
        direction: pairDirection,
        amount: pairAmount,
        purpose: next.purpose,
      })
    : null;
  const ownIds = [tx.id, ...(pair ? [pair.id] : [])];
  const clash = await prisma.bankTransaction.findFirst({
    where: { fingerprint: { in: [fingerprint, ...(pairFingerprint ? [pairFingerprint] : [])] }, id: { notIn: ownIds } },
  });
  if (clash) back("Такая операция уже есть (тот же счёт, дата, направление, сумма и назначение) — исправление сделало бы дубль");

  const common = { operationDate: next.operationDate, amount: next.amount, purpose: next.purpose };
  const [updated, updatedPair] = await prisma.$transaction([
    prisma.bankTransaction.update({
      where: { id },
      data: { ...common, direction: next.direction, bankAccountId: next.bankAccountId, cashAccountId: next.cashAccountId, fingerprint },
    }),
    ...(pair
      ? [prisma.bankTransaction.update({ where: { id: pair.id }, data: { ...common, amount: pairAmount, direction: pairDirection, fingerprint: pairFingerprint! } })]
      : []),
  ]);
  // The amount may have changed relative to the allocations: refresh "matched / partially matched".
  await Promise.all(ownIds.map((legId) => recomputeBankTransactionStatus(legId)));

  await logAudit({
    userId: session.userId,
    entityType: "bank_transaction",
    entityId: id,
    action: pair ? "edit_transfer" : "edit",
    before: tx as never,
    after: updated as never,
  });
  if (pair && updatedPair) {
    await logAudit({
      userId: session.userId,
      entityType: "bank_transaction",
      entityId: pair.id,
      action: "edit_transfer",
      before: pair as never,
      after: updatedPair as never,
    });
  }

  revalidatePath("/cash/transactions");
  for (const legId of ownIds) revalidatePath(`/cash/transactions/${legId}`);
  redirect(`/cash/transactions/${id}?notice=${encodeURIComponent(pair ? "Перевод исправлен — обе операции" : "Операция исправлена")}`);
}

/**
 * Удаление операции (у перевода — обеих ног сразу). Только без действующих
 * сопоставлений и в открытом периоде. Отменённые сопоставления удаляются
 * вместе с операцией; всё остаётся в журнале аудита.
 */
export async function deleteBankTransactionAction(id: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const back = (message: string): never => redirect(`/cash/transactions/${id}?error=${encodeURIComponent(message)}`);
  if (formData.get("confirm") !== "on") back("Отметьте «Да, удалить», чтобы подтвердить удаление");

  const { tx, pair } = await loadTransactionWithPair(session, id);
  const legs = pair ? [tx, pair] : [tx];
  const problem = checkTransactionDeletion(legs.map((leg) => ({ allocated: allocatedSum(leg) })));
  if (problem) back(problem);
  for (const leg of legs) {
    await assertPeriodOpenForDate(leg.operationDate).catch((e) => back((e as Error).message));
  }

  await removeTransactions(legs);
  for (const leg of legs) {
    await logAudit({
      userId: session.userId,
      entityType: "bank_transaction",
      entityId: leg.id,
      action: pair ? "delete_transfer" : "delete",
      before: leg as never,
    });
  }

  revalidatePath("/cash/transactions");
  const date = tx.operationDate.toLocaleDateString("ru-RU");
  redirect(
    `/cash/transactions?notice=${encodeURIComponent(
      pair ? `Перевод от ${date} удалён — обе операции` : `Операция от ${date} на ${formatMoney(tx.amount)} удалена`,
    )}`,
  );
}

/**
 * Удаляет операции одной транзакцией БД: их отменённые сопоставления, сами
 * операции и счётчики загрузок выписки («загружено» уменьшается, «удалено»
 * растёт).
 */
async function removeTransactions(legs: Array<{ id: string; batchId: string | null }>) {
  const ids = legs.map((leg) => leg.id);
  await prisma.$transaction([
    prisma.paymentAllocation.deleteMany({ where: { bankTransactionId: { in: ids } } }),
    prisma.bankTransaction.deleteMany({ where: { id: { in: ids } } }),
    ...[...deletedByBatch(legs)].map(([batchId, count]) =>
      prisma.bankImportBatch.update({ where: { id: batchId }, data: { importedRows: { decrement: count }, deletedRows: { increment: count } } }),
    ),
  ]);
}

const MAX_BULK_DELETE = 500;

/**
 * Удаление отмеченных в списке операций: по тем же правилам, что и одной —
 * перевод целиком, операции с действующими сопоставлениями и в закрытом
 * периоде пропускаются (с причиной в сообщении), только в зоне видимости
 * пользователя; каждая удалённая операция — в журнале аудита.
 */
export async function deleteBankTransactionsAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);
  const returnTo = String(formData.get("returnTo") ?? "/cash/transactions");
  const safeReturn = returnTo.startsWith("/cash/transactions") ? returnTo : "/cash/transactions";
  const withParam = (key: string, message: string) => `${safeReturn}${safeReturn.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(message)}`;
  const ids = [...new Set(formData.getAll("ids").map(String).filter(Boolean))];
  if (ids.length === 0) redirect(withParam("error", "Отметьте операции, которые нужно удалить"));
  if (ids.length > MAX_BULK_DELETE) redirect(withParam("error", `За один раз — не больше ${MAX_BULK_DELETE} операций`));
  if (formData.get("confirm") !== "on") redirect(withParam("error", "Отметьте «Да, удалить», чтобы подтвердить удаление"));

  const scope = await getAccessScope(session);
  const include = { allocations: { where: { cancelledAt: null } } } as const;
  const selected = await prisma.bankTransaction.findMany({ where: { id: { in: ids }, ...bankTransactionScopeWhere(scope) }, include });
  const groups = [...new Set(selected.map((t) => t.transferGroupId).filter((g): g is string => Boolean(g)))];
  const pairLegs = groups.length
    ? await prisma.bankTransaction.findMany({ where: { transferGroupId: { in: groups }, id: { notIn: selected.map((t) => t.id) } }, include })
    : [];
  const all = [...selected, ...pairLegs];
  const closed = new Set(
    (await prisma.accountingPeriod.findMany({ where: { status: "CLOSED" }, select: { year: true, month: true } })).map((p) => `${p.year}-${p.month}`),
  );
  const plan = planBulkDeletion(
    selected.map((t) => t.id),
    all.map((t) => ({
      id: t.id,
      transferGroupId: t.transferGroupId,
      batchId: t.batchId,
      allocated: allocatedSum(t),
      periodClosed: closed.has(`${t.operationDate.getUTCFullYear()}-${t.operationDate.getUTCMonth() + 1}`),
      label: `${t.operationDate.toLocaleDateString("ru-RU", { timeZone: "UTC" })} на ${formatMoney(t.amount)}`,
    })),
  );
  const toDelete = all.filter((t) => plan.deleteLegs.some((l) => l.id === t.id));
  if (toDelete.length > 0) await removeTransactions(toDelete);
  for (const leg of toDelete) {
    await logAudit({
      userId: session.userId,
      entityType: "bank_transaction",
      entityId: leg.id,
      action: leg.transferGroupId ? "delete_transfer" : "delete",
      before: leg as never,
    });
  }

  revalidatePath("/cash/transactions");
  revalidatePath("/cash/import");
  const parts = [`Удалено операций: ${toDelete.length}${plan.transfers ? ` (в том числе переводов целиком: ${plan.transfers})` : ""}`];
  const invisible = ids.length - selected.length;
  if (invisible > 0) parts.push(`Не найдено или вне вашей зоны видимости: ${invisible}`);
  if (plan.skipped.length > 0) {
    parts.push(`Пропущено ${plan.skipped.length}: ${plan.skipped.slice(0, 5).join("; ")}${plan.skipped.length > 5 ? " …" : ""}`);
  }
  redirect(withParam(plan.skipped.length > 0 && toDelete.length === 0 ? "error" : "notice", parts.join(". ")));
}

export async function allocatePaymentAction(transactionId: string, formData: FormData) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const accrualDocumentId = String(formData.get("accrualDocumentId") ?? "");
  const amountRaw = String(formData.get("amount") ?? "");
  if (!accrualDocumentId || !amountRaw || Number(amountRaw) <= 0) {
    redirect(`/cash/transactions/${transactionId}?error=${encodeURIComponent("Выберите документ и укажите сумму сопоставления")}`);
  }

  const document = await prisma.accrualDocument.findUniqueOrThrow({ where: { id: accrualDocumentId } });
  await assertPeriodOpenForDate(document.date).catch((e) => {
    redirect(`/cash/transactions/${transactionId}?error=${encodeURIComponent((e as Error).message)}`);
  });

  // Currencies of the payment and of the document: a rouble payment of a document in «у.е.» is converted at the payment day rate.
  const transaction = await prisma.bankTransaction.findUniqueOrThrow({
    where: { id: transactionId },
    include: { bankAccount: { select: { currency: true } }, cashAccount: { select: { currency: true } } },
  });
  const transactionCurrency = normalizeCurrency(transaction.bankAccount?.currency ?? transaction.cashAccount?.currency);
  const documentCurrency = normalizeCurrency(document.currency);
  const foreignCurrency = transactionCurrency !== "RUB" ? transactionCurrency : documentCurrency;
  let paymentDayRate = null;
  if (transactionCurrency !== documentCurrency) {
    const rates = await loadRateLookup();
    paymentDayRate = rates.rateOn(foreignCurrency, transaction.operationDate);
    // A rate from a later day is not the rate of the payment: better to ask for the rates to be loaded.
    if (rates.missingText()) paymentDayRate = null;
  }
  const planned = planAllocation({
    entered: amountRaw.replace(",", "."),
    transactionCurrency,
    documentCurrency,
    documentRate: document.exchangeRate,
    paymentDayRate,
  });
  if ("error" in planned) redirect(`/cash/transactions/${transactionId}?error=${encodeURIComponent(planned.error)}`);
  const amounts = planned as AllocationAmounts;

  const allocation = await prisma.paymentAllocation.create({
    data: {
      bankTransactionId: transactionId,
      accrualDocumentId,
      amount: amounts.amount.toFixed(2),
      currencyAmount: amounts.currencyAmount?.toFixed(2) ?? null,
      transactionAmount: amounts.transactionAmount?.toFixed(2) ?? null,
    },
  });

  await Promise.all([
    recomputeAccrualDocumentStatus(accrualDocumentId),
    recomputeBankTransactionStatus(transactionId),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "payment_allocation",
    entityId: allocation.id,
    action: "create",
    after: allocation as never,
    accrualDocumentId,
  });

  revalidatePath(`/cash/transactions/${transactionId}`);
  revalidatePath(`/accruals/${accrualDocumentId}`);
  revalidatePath("/cash/transactions");
  revalidatePath("/accruals");
  redirect(`/cash/transactions/${transactionId}`);
}

export async function cancelAllocationAction(allocationId: string) {
  const session = await requirePermission(PERMISSIONS.CASH_MANAGE);

  const allocation = await prisma.paymentAllocation.findUniqueOrThrow({ where: { id: allocationId } });
  const updated = await prisma.paymentAllocation.update({
    where: { id: allocationId },
    data: { cancelledAt: new Date() },
  });

  await Promise.all([
    recomputeAccrualDocumentStatus(allocation.accrualDocumentId),
    recomputeBankTransactionStatus(allocation.bankTransactionId),
  ]);

  await logAudit({
    userId: session.userId,
    entityType: "payment_allocation",
    entityId: allocationId,
    action: "cancel",
    before: allocation as never,
    after: updated as never,
    accrualDocumentId: allocation.accrualDocumentId,
  });

  revalidatePath(`/cash/transactions/${allocation.bankTransactionId}`);
  revalidatePath(`/accruals/${allocation.accrualDocumentId}`);
  revalidatePath("/cash/transactions");
  revalidatePath("/accruals");
}
