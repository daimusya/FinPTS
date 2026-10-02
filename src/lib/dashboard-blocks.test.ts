import { describe, expect, it } from "vitest";
import { dashboardBlocks } from "./dashboard-blocks";
import { PERMISSIONS } from "./permissions";

describe("dashboardBlocks", () => {
  it("shows everything to a full administrator", () => {
    expect(Object.values(dashboardBlocks([PERMISSIONS.ADMIN_FULL])).every(Boolean)).toBe(true);
  });

  it("a payroll clerk sees only employees", () => {
    expect(dashboardBlocks([PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.PAYROLL_MANAGE])).toEqual({
      cash: false,
      debts: false,
      requests: false,
      masterData: false,
      employees: true,
      periods: false,
      pnl: false,
    });
  });

  it("someone who only creates payment requests sees the approved requests, not money or profit", () => {
    expect(dashboardBlocks([PERMISSIONS.PAYMENT_REQUEST_CREATE])).toMatchObject({ requests: true, cash: false, pnl: false, debts: false });
  });

  it("a treasurer sees money and requests; an analyst sees debts, profit and periods", () => {
    expect(dashboardBlocks([PERMISSIONS.CASH_VIEW])).toMatchObject({ cash: true, requests: true, pnl: false, debts: false });
    expect(dashboardBlocks([PERMISSIONS.REPORTS_VIEW])).toMatchObject({ cash: false, debts: true, pnl: true, periods: true });
  });

  it("no permissions — no blocks", () => {
    expect(Object.values(dashboardBlocks([])).some(Boolean)).toBe(false);
  });
});
