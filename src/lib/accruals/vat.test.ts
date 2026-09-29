import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import { inputVatDeductible, lineNetAmount } from "./vat";
import { assembleBalance } from "@/lib/reports/balance-lines";
import { computeProjectResult } from "@/lib/integrations/project-results";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const d = (v: number) => toDecimal(v);

describe("amounts without VAT", () => {
  it("revenue always without VAT, costs — only when the input VAT is deducted", () => {
    const line = { amount: "120", vatAmount: "20" };
    expect(lineNetAmount(line, "INCOME", false).toNumber()).toBe(100);
    expect(lineNetAmount(line, "EXPENSE", true).toNumber()).toBe(100);
    expect(lineNetAmount(line, "EXPENSE", false).toNumber()).toBe(120);
    expect(lineNetAmount({ amount: "50", vatAmount: null }, "INCOME", true).toNumber()).toBe(50);
  });

  it("the input VAT is deducted on OSN and with a 22 % or 10 % rate in the card; not at 5 %, 7 %, on AUSN or the patent", () => {
    const vat = (rate: string) => [{ taxKind: "vat", ratePct: rate, validFrom: utc(2026, 1, 1) }];
    expect(inputVatDeductible({ taxSystem: "osn", rates: [] }, utc(2026, 5, 1))).toBe(true);
    expect(inputVatDeductible({ taxSystem: "usn_income", rates: [] }, utc(2026, 5, 1))).toBe(false);
    expect(inputVatDeductible({ taxSystem: "usn_income", rates: vat("22") }, utc(2026, 5, 1))).toBe(true);
    expect(inputVatDeductible({ taxSystem: "usn_income", rates: vat("22") }, utc(2025, 12, 31))).toBe(false); // before the rate
    expect(inputVatDeductible({ taxSystem: "usn_income_expense", rates: vat("5") }, utc(2026, 5, 1))).toBe(false);
    expect(inputVatDeductible({ taxSystem: "ausn_income", rates: vat("22") }, utc(2026, 5, 1))).toBe(false);
    expect(inputVatDeductible(undefined, utc(2026, 5, 1))).toBe(false);
  });

  it("the balance stays equal: debts with VAT, profit without it, the VAT owed on its own line", () => {
    // Sold for 120 incl. 20 VAT, bought for 60 incl. 10 deductible VAT; nothing paid.
    const b = assembleBalance({
      cash: d(0),
      receivable: d(120),
      payable: d(60),
      payrollPayable: d(0),
      advancesIssued: d(0),
      advancesReceived: d(0),
      netProfitFromPnl: d(50),
      articles: [{ id: "vat", name: "НДС к уплате", category: "LIABILITY", systemCode: "vat_payable", entries: d(0), linkedFlows: d(0), accrued: d(10) }],
    });
    expect(b.liabilityArticles.map((a) => [a.id, a.amount.toNumber()])).toEqual([["vat", 10]]);
    expect(b.isBalanced).toBe(true);
  });

  it("the project result is without VAT, the money with it", () => {
    const r = computeProjectResult([
      { direction: "INCOME", total: d(120), allocated: d(60), projectLines: [{ amount: d(120), net: d(100), pnlType: "REVENUE" }] },
    ]);
    expect([r.revenue.toNumber(), r.receivedFromCustomers.toNumber(), r.receivable.toNumber()]).toEqual([100, 60, 60]);
  });
});
