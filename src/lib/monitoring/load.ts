import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import { formatMoney, sumMoney } from "@/lib/money";
import { loadBackupFreshness } from "@/lib/backup/status";
import { accountCurrencies, amountInRub, loadRateLookup } from "@/lib/currency-rates";
import { localDateKey } from "@/lib/payment-calendar";
import {
  checkBackup,
  checkBankApi,
  checkDelivery,
  checkCurrencyRates,
  checkDatabase,
  checkDisk,
  checkPayments,
  checkPeriodClose,
  checkUnmatched,
  type CheckResult,
} from "./checks";

const DAY = 86_400_000;
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

async function databaseLatency(): Promise<number | null> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Date.now() - started;
  } catch {
    return null;
  }
}

/** Свободное место на диске папки резервных копий (или папки приложения, если её ещё нет). */
async function diskSpace(): Promise<{ freeBytes: number; totalBytes: number } | null> {
  // The folder is known only at run time: keep the bundler from tracing the whole project for it.
  const root = /* turbopackIgnore: true */ process.cwd();
  const dir = path.resolve(/* turbopackIgnore: true */ root, process.env.BACKUP_DIR || "backups");
  try {
    const stats = await fs.promises.statfs(fs.existsSync(dir) ? dir : root);
    return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
  } catch {
    return null;
  }
}

/** Все проверки мониторинга на текущий момент. */
export async function runChecks(now: Date = new Date()): Promise<CheckResult[]> {
  const latency = await databaseLatency();
  if (latency === null) return [checkDatabase(null)];

  const todayKey = localDateKey(now);
  const today = new Date(`${todayKey}T00:00:00Z`);
  const previous = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const [backup, connections, currencies, disk, closedCount, previousPeriod, overdue, stuck, unmatched, failedDelivery, stuckDelivery] = await Promise.all([
    loadBackupFreshness(now),
    prisma.bankConnection.findMany({ where: { isActive: true }, include: { bankAccount: true } }),
    accountCurrencies(),
    diskSpace(),
    prisma.accountingPeriod.count({ where: { OR: [{ status: "CLOSED" }, { closedAt: { not: null } }] } }),
    prisma.accountingPeriod.findUnique({ where: { year_month: { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1 } } }),
    prisma.paymentRequest.findMany({ where: { status: "APPROVED", dueDate: { lt: today } }, select: { amount: true, currency: true } }),
    prisma.paymentRequest.count({ where: { status: "PENDING_APPROVAL", updatedAt: { lt: new Date(now.getTime() - 3 * DAY) } } }),
    prisma.bankTransaction.count({ where: { matchStatus: "UNMATCHED", isTransfer: false, operationDate: { lt: new Date(today.getTime() - 14 * DAY) } } }),
    prisma.notification.findMany({
      where: { deliveryState: "failed", createdAt: { gte: new Date(now.getTime() - DAY) } },
      select: { deliveryError: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({ where: { deliveryState: "pending", createdAt: { lt: new Date(now.getTime() - DAY / 24) } } }),
  ]);
  const rates = await loadRateLookup();
  const latestRates = await Promise.all(
    currencies.map(async (currency) => ({
      currency,
      date: (await prisma.currencyRate.findFirst({ where: { currency, isArchived: false }, orderBy: { date: "desc" }, select: { date: true } }))?.date ?? null,
    })),
  );

  return [
    checkDatabase(latency),
    checkBackup(backup),
    checkBankApi(
      connections.map((c) => ({
        label: `${c.bankAccount.bankName} · ${c.bankAccount.accountNumber}`,
        lastStatus: c.lastStatus,
        lastSuccessAt: c.lastSuccessAt,
        lastMessage: c.lastMessage,
      })),
      now,
    ),
    checkCurrencyRates(latestRates, now),
    checkDisk(disk),
    checkPeriodClose({
      usesClosing: closedCount > 0,
      previousClosed: previousPeriod?.status === "CLOSED",
      previousLabel: `${MONTHS[previous.getUTCMonth()]} ${previous.getUTCFullYear()}`,
      dayOfMonth: Number(todayKey.slice(8, 10)),
    }),
    checkPayments({ overdue: overdue.length, overdueSum: formatMoney(sumMoney(overdue.map((r) => amountInRub(r.amount.toString(), r.currency, rates, now) ?? r.amount))), stuck }),
    checkUnmatched(unmatched),
    checkDelivery({ failedLastDay: failedDelivery.length, stuck: stuckDelivery, lastError: failedDelivery[0]?.deliveryError ?? null }),
  ];
}

export interface SystemMetrics {
  databaseBytes: number | null;
  activeUsers: number;
  organizations: number;
  bankTransactions: number;
  bankTransactionsLast7Days: number;
  accrualDocuments: number;
  paymentRequestsPending: number;
  unreadNotifications: number;
  processUptimeSeconds: number;
}

/** Числовые показатели для страницы мониторинга и /api/metrics (без персональных данных). */
export async function loadMetrics(now: Date = new Date()): Promise<SystemMetrics> {
  const [size, activeUsers, organizations, bankTransactions, recent, accrualDocuments, pending, unread] = await Promise.all([
    prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`.catch(() => null),
    prisma.user.count({ where: { isActive: true } }),
    prisma.organization.count({ where: { isArchived: false } }),
    prisma.bankTransaction.count(),
    prisma.bankTransaction.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    prisma.accrualDocument.count(),
    prisma.paymentRequest.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.notification.count({ where: { readAt: null } }),
  ]);
  return {
    databaseBytes: size?.[0] ? Number(size[0].size) : null,
    activeUsers,
    organizations,
    bankTransactions,
    bankTransactionsLast7Days: recent,
    accrualDocuments,
    paymentRequestsPending: pending,
    unreadNotifications: unread,
    processUptimeSeconds: Math.round(process.uptime()),
  };
}
