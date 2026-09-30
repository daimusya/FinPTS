import { prisma } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { PERMISSIONS } from "@/lib/permissions";
import type { CheckResult } from "./checks";
import { runChecks } from "./load";

/** Повторять оповещение о той же непрошедшей проблеме не чаще раза в сутки. */
export const REMIND_AFTER_MS = 24 * 3_600_000;

export interface AlertState {
  key: string;
  status: string;
  message: string;
  firstSeenAt: Date;
  lastNotifiedAt: Date;
  resolvedAt: Date | null;
}

export interface AlertNotice {
  key: string;
  title: string;
  body: string;
  link: string | null;
}

export interface AlertPlan {
  notices: AlertNotice[];
  /** Новое состояние строк monitor_alerts (создать или обновить). */
  states: AlertState[];
}

const STATUS_WORD: Record<string, string> = { fail: "сбой", warn: "предупреждение" };

/**
 * Что разослать по результатам проверок. Проблема появилась или стала
 * серьёзнее (предупреждение → сбой) — оповещение сразу; держится дольше
 * суток — напоминание раз в сутки; прошла — оповещение «в порядке». Пока
 * ничего не меняется, повторов нет (проверки идут каждые полчаса).
 */
export function planAlerts(checks: CheckResult[], previous: AlertState[], now: Date): AlertPlan {
  const byKey = new Map(previous.map((p) => [p.key, p]));
  const plan: AlertPlan = { notices: [], states: [] };
  for (const check of checks) {
    const before = byKey.get(check.key);
    const active = before && !before.resolvedAt ? before : null;
    if (check.status === "ok") {
      if (active) {
        plan.notices.push({ key: check.key, title: `Мониторинг: ${check.title} — снова в порядке`, body: check.message, link: check.link });
        plan.states.push({ ...active, resolvedAt: now });
      }
      continue;
    }
    const worse = active && active.status === "warn" && check.status === "fail";
    const remind = active && now.getTime() - active.lastNotifiedAt.getTime() >= REMIND_AFTER_MS;
    if (!active || worse || remind) {
      const prefix = active && !worse ? "всё ещё " : "";
      plan.notices.push({ key: check.key, title: `Мониторинг: ${check.title} — ${prefix}${STATUS_WORD[check.status]}`, body: check.message, link: check.link });
      plan.states.push({
        key: check.key,
        status: check.status,
        message: check.message,
        firstSeenAt: active ? active.firstSeenAt : now,
        lastNotifiedAt: now,
        resolvedAt: null,
      });
    } else if (active.message !== check.message || active.status !== check.status) {
      plan.states.push({ ...active, status: check.status, message: check.message });
    }
  }
  return plan;
}

/** Активные полные администраторы — получатели оповещений мониторинга. */
async function administrators(): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, roles: { some: { role: { permissions: { some: { permission: { code: PERMISSIONS.ADMIN_FULL } } } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Проверки и рассылка оповещений администраторам (колокольчик в системе).
 * Запускается планировщиком вместе с выписками (scripts/bank-sync.ts) и
 * вручную — npm run monitor. Возвращает строки для журнала.
 */
export async function runMonitoring(now: Date = new Date()): Promise<{ checks: CheckResult[]; notices: AlertNotice[]; recipients: number }> {
  const checks = await runChecks(now);
  const previous = await prisma.monitorAlert.findMany();
  const plan = planAlerts(checks, previous, now);
  const recipients = plan.notices.length > 0 ? await administrators() : [];
  for (const notice of plan.notices) {
    await notify(recipients, { title: notice.title, body: notice.body, link: notice.link ?? "/admin/monitoring" });
  }
  for (const state of plan.states) {
    await prisma.monitorAlert.upsert({ where: { key: state.key }, create: state, update: state });
  }
  return { checks, notices: plan.notices, recipients: recipients.length };
}
