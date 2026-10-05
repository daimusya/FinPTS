"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requirePermission, requireSession, hasPermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { PaymentRequestStatus } from "@prisma/client";
import { PAYMENT_REQUEST_STATUS_LABELS } from "@/lib/payment-requests/labels";
import { parseAccountKey, parseDueTime } from "@/lib/payment-calendar";
import { readScheduleRows } from "@/lib/payment-requests/parts";
import {
  assignPaymentAccount,
  markPartPaid,
  markRemainingPartsPaid,
  removePaymentSchedule,
  rescheduleRequest,
  savePaymentSchedule,
  type PlanResult,
} from "@/lib/payment-plan/service";
import {
  selectApprovalRoute,
  roleForStep,
  isFinalStep,
  parseDecisionComment,
  type ApprovalDecision,
  type ApprovalRouteCandidate,
} from "@/lib/payment-requests/approval";
import { stepAuthority } from "@/lib/payment-requests/delegation";
import { normalizeCurrency } from "@/lib/currency";
import { amountInRub, loadRateLookup } from "@/lib/currency-rates";
import { currencyNotAllowed } from "@/lib/foreign-currency";
import { isVisible, NOT_VISIBLE, ORGANIZATION_NOT_ALLOWED, organizationAllowed } from "@/lib/access-guard";
import { currentDeciders, notifyAuthor, notifyDeciders } from "@/lib/payment-requests/notify";
import { parseFormAmount, parseFormDate } from "@/lib/form-values";
import { yearProblem } from "@/lib/form-values";

async function loadActiveRoutes(): Promise<ApprovalRouteCandidate[]> {
  const routes = await prisma.paymentApprovalRoute.findMany({
    where: { isArchived: false },
    include: { steps: true },
  });
  return routes.map((r) => ({
    id: r.id,
    priority: r.priority,
    minAmount: r.minAmount,
    maxAmount: r.maxAmount,
    organizationId: r.organizationId,
    steps: r.steps.map((s) => ({ stepOrder: s.stepOrder, roleId: s.roleId })),
  }));
}

export async function createPaymentRequestAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.PAYMENT_REQUEST_CREATE);
  if (!(await organizationAllowed(session, String(formData.get("organizationId") ?? "")))) redirect(`/payment-requests/new?error=${encodeURIComponent(ORGANIZATION_NOT_ALLOWED)}`);

  const organizationId = String(formData.get("organizationId") ?? "");
  const counterpartyId = String(formData.get("counterpartyId") ?? "") || null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const amountInput = parseFormAmount(formData.get("amount"));
  const amountRaw = "value" in amountInput ? amountInput.value : "";
  const dueDateRaw = String(formData.get("dueDate") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;

  if (!organizationId || !dueDateRaw) {
    redirect(`/payment-requests/new?error=${encodeURIComponent("Заполните организацию, сумму и срок оплаты")}`);
  }
  if ("error" in amountInput) redirect(`/payment-requests/new?error=${encodeURIComponent(amountInput.error)}`);
  const dueInput = parseFormDate(dueDateRaw, "Срок оплаты");
  if ("error" in dueInput) redirect(`/payment-requests/new?error=${encodeURIComponent(dueInput.error)}`);
  const dueTime = parseDueTime(formData.get("dueTime"));
  if ("error" in dueTime) redirect(`/payment-requests/new?error=${encodeURIComponent(dueTime.error)}`);

  const payAccountRaw = String(formData.get("payAccount") ?? "");
  const payAccount = payAccountRaw ? parseAccountKey(payAccountRaw) : { bankAccountId: null, cashAccountId: null };
  if (!payAccount) redirect(`/payment-requests/new?error=${encodeURIComponent("Выберите счёт или кассу оплаты из списка")}`);
  const accountOrg = payAccount!.bankAccountId
    ? (await prisma.bankAccount.findUnique({ where: { id: payAccount!.bankAccountId } }))?.organizationId
    : payAccount!.cashAccountId
      ? (await prisma.cashAccount.findUnique({ where: { id: payAccount!.cashAccountId } }))?.organizationId
      : organizationId;
  if (accountOrg !== organizationId) {
    redirect(`/payment-requests/new?error=${encodeURIComponent("Счёт оплаты должен принадлежать организации заявки")}`);
  }

  // A request in a foreign currency is routed by its rouble equivalent at today's rate (route limits are in roubles).
  const currency = normalizeCurrency(formData.get("currency"));
  const currencyProblem = await currencyNotAllowed(organizationId, currency);
  if (currencyProblem) redirect(`/payment-requests/new?error=${encodeURIComponent(currencyProblem)}`);
  const amountRub = amountInRub(amountRaw, currency, await loadRateLookup());
  if (!amountRub) redirect(`/payment-requests/new?error=${encodeURIComponent(`Нет курса ЦБ ${currency} — загрузите курсы в справочнике «Курсы валют»`)}`);
  const routes = await loadActiveRoutes();
  const route = selectApprovalRoute(routes, { amount: amountRub!.toString(), organizationId });

  const created = await prisma.paymentRequest.create({
    data: {
      organizationId,
      counterpartyId,
      cashFlowArticleId,
      amount: amountRaw,
      currency,
      dueDate: (dueInput as { date: Date }).date,
      dueTime: "time" in dueTime ? dueTime.time : null,
      comment,
      createdById: session.userId,
      status: PaymentRequestStatus.PENDING_APPROVAL,
      routeId: route?.id ?? null,
      currentStep: 1,
      payBankAccountId: payAccount!.bankAccountId,
      payCashAccountId: payAccount!.cashAccountId,
    },
  });

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: created.id,
    action: "create",
    after: created as never,
  });
  await notifyDeciders(created.id, session.userId);

  revalidatePath("/payment-requests");
  redirect("/payment-requests");
}

const TRANSITION_PERMISSION: Record<string, (typeof PERMISSIONS)[keyof typeof PERMISSIONS]> = {
  [PaymentRequestStatus.CANCELLED]: PERMISSIONS.PAYMENT_REQUEST_APPROVE,
  [PaymentRequestStatus.PAID]: PERMISSIONS.CASH_MANAGE,
};

const TRANSITION_FROM: Partial<Record<PaymentRequestStatus, PaymentRequestStatus[]>> = {
  [PaymentRequestStatus.CANCELLED]: [PaymentRequestStatus.PENDING_APPROVAL, PaymentRequestStatus.APPROVED, PaymentRequestStatus.RETURNED],
  [PaymentRequestStatus.PAID]: [PaymentRequestStatus.APPROVED],
};

async function transition(id: string, status: PaymentRequestStatus, action: string, formData?: FormData) {
  const session = await requirePermission(TRANSITION_PERMISSION[status]);
  if (!(await isVisible(session, "request", id))) redirect(`/payment-requests?error=${encodeURIComponent(NOT_VISIBLE)}`);

  const before = await prisma.paymentRequest.findUniqueOrThrow({ where: { id } });
  // A stale page must not mark a cancelled request as paid or cancel a paid one.
  const allowedFrom = TRANSITION_FROM[status] ?? [];
  const moved = await prisma.$transaction(async (db) => {
    const result = await db.paymentRequest.updateMany({ where: { id, status: { in: allowedFrom } }, data: { status } });
    if (result.count > 0 && status === PaymentRequestStatus.PAID) await markRemainingPartsPaid(db, id, session.userId);
    return result;
  });
  if (moved.count === 0) {
    const backTo = formData?.get("returnTo") === "detail" ? `/payment-requests/${id}` : "/payment-requests";
    redirect(`${backTo}?error=${encodeURIComponent(`Заявка уже в статусе «${PAYMENT_REQUEST_STATUS_LABELS[before.status]}» — действие не выполнено`)}`);
  }
  const updated = await prisma.paymentRequest.findUniqueOrThrow({ where: { id } });

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action,
    before: before as never,
    after: updated as never,
  });
  await notifyAuthor(id, status === PaymentRequestStatus.PAID ? "Заявка оплачена" : "Заявка отменена", null, session.userId);

  revalidatePath("/payment-requests");
  revalidatePath(`/payment-requests/${id}`);
  revalidatePath("/payment-calendar");
  if (formData?.get("returnTo") === "detail") redirect(`/payment-requests/${id}`);
}

/**
 * Согласование/отклонение шага маршрута. Заявка без маршрута (routeId
 * null) идёт по старому одноступенчатому согласованию — нужно общее право
 * payment_requests.approve. Заявка с маршрутом требует членства именно в
 * роли текущего шага (или admin.full в обход) — так «Руководитель
 * подразделения» может согласовать свой шаг, даже не имея этого общего
 * права.
 */
async function decideStep(id: string, decision: ApprovalDecision, formData: FormData) {
  const session = await requireSession();
  if (!(await isVisible(session, "request", id))) redirect(`/payment-requests?error=${encodeURIComponent(NOT_VISIBLE)}`);
  // Decisions come from the request page or from the list; errors go back to the same place.
  const backTo = formData.get("returnTo") === "detail" ? `/payment-requests/${id}` : "/payment-requests";
  const fail = (message: string): never => redirect(`${backTo}?error=${encodeURIComponent(message)}`);

  const parsedComment = parseDecisionComment(decision, formData.get("comment"));
  if ("error" in parsedComment) fail(parsedComment.error);
  const comment = (parsedComment as { comment: string | null }).comment;

  const request = await prisma.paymentRequest.findUniqueOrThrow({
    where: { id },
    include: { route: { include: { steps: true } } },
  });

  if (request.status !== PaymentRequestStatus.PENDING_APPROVAL) {
    fail("Заявка уже не на согласовании");
  }
  // The page may be stale: someone else could have decided this step meanwhile.
  const expectedStep = Number(formData.get("expectedStep") ?? request.currentStep);
  if (expectedStep !== request.currentStep) {
    fail("По этой заявке уже принято решение на шаге " + expectedStep + " — проверьте историю согласования");
  }

  const isAdmin = hasPermission(session, PERMISSIONS.ADMIN_FULL);
  let stepOrder: number | null = null;
  // A deputy decides for the approver they stand in for (the decision records both).
  let onBehalfOfId: string | null = null;

  if (!request.route) {
    if (!isAdmin && !hasPermission(session, PERMISSIONS.PAYMENT_REQUEST_APPROVE)) {
      const deputy = (await currentDeciders(id)).find((d) => d.userId === session.userId && d.onBehalfOfId);
      if (!deputy) fail("Недостаточно прав для согласования этой заявки");
      onBehalfOfId = deputy!.onBehalfOfId;
    }
  } else {
    stepOrder = request.currentStep;
    const requiredRoleId = roleForStep(
      {
        id: request.route.id,
        priority: request.route.priority,
        minAmount: request.route.minAmount,
        maxAmount: request.route.maxAmount,
        organizationId: request.route.organizationId,
        steps: request.route.steps.map((s) => ({ stepOrder: s.stepOrder, roleId: s.roleId })),
      },
      request.currentStep,
    );
    if (!isAdmin) {
      const authority = requiredRoleId ? await stepAuthority(session.userId, requiredRoleId) : { allowed: false, onBehalfOfId: null };
      if (!authority.allowed) {
        fail("Вы не назначены согласующим на этом шаге маршрута и никого на нём сейчас не замещаете");
      }
      onBehalfOfId = authority.onBehalfOfId;
    }
  }

  const before = request;
  const isFinal =
    !request.route ||
    isFinalStep(
      {
        id: request.route.id,
        priority: request.route.priority,
        minAmount: request.route.minAmount,
        maxAmount: request.route.maxAmount,
        organizationId: request.route.organizationId,
        steps: request.route.steps.map((s) => ({ stepOrder: s.stepOrder, roleId: s.roleId })),
      },
      request.currentStep,
    );

  const nextStatus =
    decision === "rejected"
      ? PaymentRequestStatus.REJECTED
      : decision === "returned"
        ? PaymentRequestStatus.RETURNED
        : isFinal
          ? PaymentRequestStatus.APPROVED
          : PaymentRequestStatus.PENDING_APPROVAL;

  // Conditional update: only if the request is still on this step, so two approvers
  // pressing the button at once cannot both decide it. The decision is written in the same transaction.
  const decided = await prisma.$transaction(async (db) => {
    const moved = await db.paymentRequest.updateMany({
      where: { id, status: PaymentRequestStatus.PENDING_APPROVAL, currentStep: request.currentStep },
      data: {
        status: nextStatus,
        currentStep: decision === "approved" && !isFinal ? request.currentStep + 1 : request.currentStep,
      },
    });
    if (moved.count === 0) return null;
    await db.paymentRequestApproval.create({
      data: { paymentRequestId: id, approverId: session.userId, decision, stepOrder, comment, round: request.round, onBehalfOfId },
    });
    return db.paymentRequest.findUniqueOrThrow({ where: { id } });
  });
  if (!decided) fail("По этой заявке только что принято другое решение — проверьте историю согласования");
  const updated = decided!;

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action: decision === "approved" ? "approve_step" : decision === "returned" ? "return_for_rework" : "reject_step",
    before: before as never,
    after: { ...updated, decisionComment: comment, decidedStep: stepOrder, onBehalfOfId } as never,
  });

  const note = comment ? `Комментарий: ${comment}` : null;
  if (decision === "rejected") await notifyAuthor(id, "Заявка отклонена", note, session.userId);
  else if (decision === "returned") await notifyAuthor(id, "Заявка возвращена на доработку", note, session.userId);
  else if (updated.status === PaymentRequestStatus.APPROVED) await notifyAuthor(id, "Заявка согласована", note, session.userId);
  else {
    await notifyAuthor(id, `Заявка согласована на шаге ${stepOrder}`, note, session.userId);
    await notifyDeciders(id, session.userId);
  }

  revalidatePath("/payment-requests");
  revalidatePath(`/payment-requests/${id}`);
  revalidatePath("/payment-calendar");
  if (backTo !== "/payment-requests") redirect(backTo);
}

export async function approvePaymentRequestAction(id: string, formData: FormData) {
  await decideStep(id, "approved", formData);
}

export async function rejectPaymentRequestAction(id: string, formData: FormData) {
  await decideStep(id, "rejected", formData);
}

export async function returnPaymentRequestAction(id: string, formData: FormData) {
  await decideStep(id, "returned", formData);
}

/**
 * Доработка и повторная отправка: автор (или администратор) правит
 * возвращённую или отклонённую заявку и отправляет её заново — начинается
 * новый круг согласования с первого шага, маршрут подбирается под новую
 * сумму. Прежние решения остаются в истории. Если сумма изменилась, график
 * оплаты частями удаляется — его нужно задать заново.
 */
export async function resubmitPaymentRequestAction(id: string, formData: FormData) {
  const session = await requireSession();
  if (!(await isVisible(session, "request", id))) redirect(`/payment-requests?error=${encodeURIComponent(NOT_VISIBLE)}`);
  const fail = (message: string): never => redirect(`/payment-requests/${id}?error=${encodeURIComponent(message)}`);
  const request = await prisma.paymentRequest.findUniqueOrThrow({ where: { id }, include: { parts: true } });
  if (request.createdById !== session.userId && !hasPermission(session, PERMISSIONS.ADMIN_FULL)) fail("Дорабатывать заявку может её автор");
  const reworkable: PaymentRequestStatus[] = [PaymentRequestStatus.RETURNED, PaymentRequestStatus.REJECTED];
  if (!reworkable.includes(request.status)) fail("Заявку можно доработать, только если её вернули на доработку или отклонили");

  const counterpartyId = String(formData.get("counterpartyId") ?? "") || null;
  const cashFlowArticleId = String(formData.get("cashFlowArticleId") ?? "") || null;
  const amountRaw = String(formData.get("amount") ?? "").replace(/\s/g, "").replace(",", ".");
  const dueDateRaw = String(formData.get("dueDate") ?? "");
  const comment = String(formData.get("comment") ?? "").trim() || null;
  const note = String(formData.get("resubmitNote") ?? "").trim().slice(0, 1000) || null;
  if (!/^\d+(\.\d{1,2})?$/.test(amountRaw) || Number(amountRaw) <= 0) fail("Сумма — положительное число");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw)) fail("Укажите срок оплаты");
  const dueYear = yearProblem(dueDateRaw);
  if (dueYear) fail(`Срок оплаты: ${dueYear}`);
  const dueTime = parseDueTime(formData.get("dueTime"));
  if ("error" in dueTime) fail(dueTime.error);

  const currency = normalizeCurrency(formData.get("currency") ?? request.currency);
  // A request already in a currency may stay in it; a new currency needs the organization to work with currency.
  if (currency !== request.currency) {
    const currencyProblem = await currencyNotAllowed(request.organizationId, currency);
    if (currencyProblem) fail(currencyProblem);
  }
  const amountRub = amountInRub(amountRaw, currency, await loadRateLookup());
  if (!amountRub) fail(`Нет курса ЦБ ${currency} — загрузите курсы в справочнике «Курсы валют»`);
  const route = selectApprovalRoute(await loadActiveRoutes(), { amount: amountRub!.toString(), organizationId: request.organizationId });
  const amountChanged = Number(request.amount.toString()) !== Number(amountRaw) || request.currency !== currency;
  const updated = await prisma.$transaction(async (db) => {
    const moved = await db.paymentRequest.updateMany({
      where: { id, status: { in: reworkable } },
      data: {
        counterpartyId,
        cashFlowArticleId,
        amount: amountRaw,
        currency,
        dueDate: new Date(`${dueDateRaw}T00:00:00Z`),
        dueTime: "time" in dueTime ? dueTime.time : null,
        comment,
        status: PaymentRequestStatus.PENDING_APPROVAL,
        routeId: route?.id ?? null,
        currentStep: 1,
        round: request.round + 1,
      },
    });
    if (moved.count === 0) return null;
    if (amountChanged && request.parts.length > 0) await db.paymentRequestPart.deleteMany({ where: { paymentRequestId: id } });
    await db.paymentRequestApproval.create({
      data: { paymentRequestId: id, approverId: session.userId, decision: "resubmitted", stepOrder: null, comment: note, round: request.round + 1 },
    });
    return db.paymentRequest.findUniqueOrThrow({ where: { id } });
  });
  if (!updated) fail("Заявку уже изменили — обновите страницу");

  await logAudit({
    userId: session.userId,
    entityType: "payment_request",
    entityId: id,
    action: "resubmit",
    before: request as never,
    after: { ...updated, resubmitNote: note, scheduleRemoved: amountChanged && request.parts.length > 0 } as never,
  });
  await notifyDeciders(id, session.userId);

  revalidatePath("/payment-requests");
  revalidatePath(`/payment-requests/${id}`);
  revalidatePath("/payment-calendar");
  redirect(
    `/payment-requests/${id}?notice=${encodeURIComponent(
      `Заявка отправлена на согласование заново (круг ${request.round + 1})${amountChanged && request.parts.length > 0 ? "; сумма изменилась — график оплаты частями удалён, задайте его заново" : ""}`,
    )}`,
  );
}

export async function markPaymentRequestPaidAction(id: string, formData?: FormData) {
  await transition(id, PaymentRequestStatus.PAID, "mark_paid", formData);
}

export async function cancelPaymentRequestAction(id: string, formData?: FormData) {
  await transition(id, PaymentRequestStatus.CANCELLED, "cancel", formData);
}

/** Перенос срока со страницы заявки (форма с датой, временем и причиной). */
export async function reschedulePaymentRequestAction(id: string, formData: FormData) {
  const session = await requireSession();
  const result = await rescheduleRequest(session, id, formData.get("dueDate"), formData.get("reason"), formData.get("dueTime") ?? "");
  backToRequest(id, result);
}

/** График оплаты частями: параллельные поля partId / partDueDate / partDueTime / partAmount. */
export async function savePaymentScheduleAction(id: string, formData: FormData) {
  const session = await requireSession();
  const rows = readScheduleRows(formData.getAll("partId"), formData.getAll("partDueDate"), formData.getAll("partAmount"), formData.getAll("partDueTime"));
  const result = await savePaymentSchedule(session, id, rows);
  backToRequest(id, result);
}

export async function removePaymentScheduleAction(id: string) {
  const session = await requireSession();
  backToRequest(id, await removePaymentSchedule(session, id));
}

export async function markPaymentPartPaidAction(requestId: string, partId: string) {
  const session = await requireSession();
  backToRequest(requestId, await markPartPaid(session, partId));
}

export async function assignRequestAccountAction(id: string, formData: FormData) {
  const session = await requireSession();
  backToRequest(id, await assignPaymentAccount(session, "request", id, formData.get("payAccount")));
}

function backToRequest(id: string, result: PlanResult): never {
  const param = result.ok ? `notice=${encodeURIComponent(result.message)}` : `error=${encodeURIComponent((result as { error: string }).error)}`;
  redirect(`/payment-requests/${id}?${param}`);
}
