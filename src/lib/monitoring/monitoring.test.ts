import { describe, expect, it } from "vitest";
import {
  checkBackup,
  checkBankApi,
  checkCurrencyRates,
  checkDisk,
  checkPayments,
  checkPeriodClose,
  checkUnmatched,
  overallStatus,
  type CheckResult,
} from "./checks";
import { planAlerts, REMIND_AFTER_MS, type AlertState } from "./alerts";
import { formatPrometheus } from "./prometheus";

const now = new Date("2026-09-30T09:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("checks", () => {
  it("backup: none or stale is a failure, a failed mirror a warning", () => {
    expect(checkBackup({ state: "never", ageHours: null, mirror: "off" }).status).toBe("fail");
    expect(checkBackup({ state: "stale", ageHours: 40, mirror: "ok" })).toMatchObject({ status: "fail", message: "Последняя успешная копия — 40 ч назад" });
    expect(checkBackup({ state: "ok", ageHours: 3, mirror: "failed" }).status).toBe("warn");
    expect(checkBackup({ state: "ok", ageHours: 3, mirror: "ok" }).status).toBe("ok");
  });

  it("bank API: an error fails, no success for 3 hours warns, no connections is fine", () => {
    const conn = (lastStatus: string | null, lastSuccessAt: Date | null) => ({ label: "Т-Банк · 4070", lastStatus, lastSuccessAt, lastMessage: lastStatus === "error" ? "401" : null });
    expect(checkBankApi([], now).status).toBe("ok");
    expect(checkBankApi([conn("error", hoursAgo(1))], now)).toMatchObject({ status: "fail", message: "Ошибка загрузки: Т-Банк · 4070 — 401" });
    expect(checkBankApi([conn("ok", hoursAgo(5))], now).message).toContain("Т-Банк · 4070 (5 ч)");
    expect(checkBankApi([conn("ok", hoursAgo(0.5))], now).status).toBe("ok");
  });

  it("currency rates older than 4 days warn", () => {
    expect(checkCurrencyRates([], now).status).toBe("ok");
    expect(checkCurrencyRates([{ currency: "USD", date: new Date("2026-09-29T00:00:00Z") }], now).status).toBe("ok");
    expect(checkCurrencyRates([{ currency: "USD", date: new Date("2026-09-20T00:00:00Z") }, { currency: "EUR", date: null }], now).message).toBe(
      "Нет свежего курса: USD (последний на 20.09.2026), EUR (ни одного)",
    );
  });

  it("disk: under 2 GB or 5% warns, under 0.5 GB or 1% fails", () => {
    const gb = 1024 ** 3;
    expect(checkDisk({ freeBytes: 50 * gb, totalBytes: 200 * gb }).status).toBe("ok");
    expect(checkDisk({ freeBytes: 1.5 * gb, totalBytes: 20 * gb }).status).toBe("warn");
    expect(checkDisk({ freeBytes: 0.3 * gb, totalBytes: 200 * gb }).status).toBe("fail");
    expect(checkDisk(null).status).toBe("ok");
  });

  it("period close warns from the 15th, and only when periods are closed at all", () => {
    const input = { usesClosing: true, previousClosed: false, previousLabel: "Август 2026", dayOfMonth: 16 };
    expect(checkPeriodClose(input)).toMatchObject({ status: "warn", message: "Август 2026 не закрыт, а уже 16-е число" });
    expect(checkPeriodClose({ ...input, dayOfMonth: 10 }).status).toBe("ok");
    expect(checkPeriodClose({ ...input, usesClosing: false }).status).toBe("ok");
  });

  it("payments and unmatched operations warn with counts in proper Russian", () => {
    expect(checkPayments({ overdue: 2, overdueSum: "30 000,00 ₽", stuck: 1 }).message).toBe(
      "просрочена оплата 2 заявок на 30 000,00 ₽; 1 заявка больше 3 дней ждут решения",
    );
    expect(checkPayments({ overdue: 0, overdueSum: "0", stuck: 0 }).status).toBe("ok");
    expect(checkUnmatched(3).message).toBe("3 операции больше 14 дней без сопоставления с документами");
    expect(checkUnmatched(0).status).toBe("ok");
  });

  it("the overall status is the worst one", () => {
    const c = (status: "ok" | "warn" | "fail"): CheckResult => ({ key: status, title: status, status, message: "", link: null });
    expect(overallStatus([c("ok"), c("warn")])).toBe("warn");
    expect(overallStatus([c("warn"), c("fail")])).toBe("fail");
    expect(overallStatus([c("ok")])).toBe("ok");
  });
});

describe("planAlerts", () => {
  const check = (status: "ok" | "warn" | "fail", message = "подробности"): CheckResult => ({ key: "backup", title: "Резервные копии", status, message, link: "/admin/backups" });
  const state = (over: Partial<AlertState>): AlertState => ({
    key: "backup",
    status: "warn",
    message: "подробности",
    firstSeenAt: hoursAgo(2),
    lastNotifiedAt: hoursAgo(2),
    resolvedAt: null,
    ...over,
  });

  it("notifies when a problem appears, not again while it stays the same", () => {
    const first = planAlerts([check("fail")], [], now);
    expect(first.notices).toEqual([{ key: "backup", title: "Мониторинг: Резервные копии — сбой", body: "подробности", link: "/admin/backups" }]);
    expect(first.states[0]).toMatchObject({ status: "fail", firstSeenAt: now, lastNotifiedAt: now, resolvedAt: null });

    const same = planAlerts([check("fail")], [state({ status: "fail" })], now);
    expect(same.notices).toEqual([]);
    expect(same.states).toEqual([]);
  });

  it("notifies again when it gets worse, and reminds once a day", () => {
    expect(planAlerts([check("fail")], [state({ status: "warn" })], now).notices[0].title).toBe("Мониторинг: Резервные копии — сбой");
    const remind = planAlerts([check("warn")], [state({ lastNotifiedAt: new Date(now.getTime() - REMIND_AFTER_MS) })], now);
    expect(remind.notices[0].title).toBe("Мониторинг: Резервные копии — всё ещё предупреждение");
    expect(remind.states[0].firstSeenAt).toEqual(hoursAgo(2));
  });

  it("keeps the latest message without notifying, and reports recovery once", () => {
    expect(planAlerts([check("warn", "новый текст")], [state({})], now)).toMatchObject({ notices: [], states: [{ message: "новый текст" }] });
    const recovered = planAlerts([check("ok", "Последняя копия 1 ч назад")], [state({})], now);
    expect(recovered.notices[0].title).toBe("Мониторинг: Резервные копии — снова в порядке");
    expect(recovered.states[0].resolvedAt).toEqual(now);
    expect(planAlerts([check("ok")], [state({ resolvedAt: hoursAgo(1) })], now).notices).toEqual([]);
  });

  it("a problem that comes back after recovery is a new one", () => {
    const again = planAlerts([check("warn")], [state({ resolvedAt: hoursAgo(1), firstSeenAt: hoursAgo(50) })], now);
    expect(again.notices[0].title).toBe("Мониторинг: Резервные копии — предупреждение");
    expect(again.states[0].firstSeenAt).toEqual(now);
  });
});

describe("formatPrometheus", () => {
  it("prints check states and gauges, skipping unknown values", () => {
    const text = formatPrometheus(
      [
        { key: "database", title: "", status: "ok", message: "", link: null },
        { key: "backup", title: "", status: "fail", message: "", link: null },
      ],
      {
        databaseBytes: null,
        activeUsers: 3,
        organizations: 1,
        bankTransactions: 10,
        bankTransactionsLast7Days: 2,
        accrualDocuments: 4,
        paymentRequestsPending: 0,
        unreadNotifications: 5,
        processUptimeSeconds: 60,
      },
    );
    expect(text).toContain('promtehnosfera_check_status{check="database"} 0\n');
    expect(text).toContain('promtehnosfera_check_status{check="backup"} 2\n');
    expect(text).toContain("promtehnosfera_active_users 3\n");
    expect(text).not.toContain("database_bytes");
  });
});
