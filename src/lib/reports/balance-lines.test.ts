import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import {
  acceptsManualEntries,
  advanceFromTransaction,
  allocatedAsOf,
  assembleBalance,
  linkedFlowEffect,
  type BalanceArticleInput,
} from "./balance-lines";

const d = (v: number) => toDecimal(v);

describe("linkedFlowEffect", () => {
  it("increases an asset when money is paid for it and a liability or equity when money comes in", () => {
    expect(linkedFlowEffect("ASSET", "OUTFLOW", d(100)).toNumber()).toBe(100);
    expect(linkedFlowEffect("ASSET", "INFLOW", d(100)).toNumber()).toBe(-100);
    expect(linkedFlowEffect("LIABILITY", "INFLOW", d(500)).toNumber()).toBe(500);
    expect(linkedFlowEffect("LIABILITY", "OUTFLOW", d(50)).toNumber()).toBe(-50);
    expect(linkedFlowEffect("EQUITY", "INFLOW", d(10)).toNumber()).toBe(10);
  });
});

describe("advanceFromTransaction", () => {
  const base = { amount: d(1000), allocated: d(0), hasCounterparty: true, isTransfer: false, linkedToBalance: false };

  it("treats the unmatched part of a counterparty payment as an advance", () => {
    expect(advanceFromTransaction({ ...base, direction: "INFLOW", allocated: d(400) }).received.toNumber()).toBe(600);
    expect(advanceFromTransaction({ ...base, direction: "OUTFLOW" }).issued.toNumber()).toBe(1000);
    expect(advanceFromTransaction({ ...base, direction: "OUTFLOW", allocated: d(1000) }).issued.toNumber()).toBe(0);
  });

  it("ignores transfers, payments without a counterparty and balance-linked articles", () => {
    for (const over of [{ isTransfer: true }, { hasCounterparty: false }, { linkedToBalance: true }]) {
      const r = advanceFromTransaction({ ...base, direction: "INFLOW", ...over });
      expect([r.issued.toNumber(), r.received.toNumber()]).toEqual([0, 0]);
    }
  });
});

describe("acceptsManualEntries", () => {
  it("allows entries on manual articles and retained earnings, not on derived lines", () => {
    expect(acceptsManualEntries(null)).toBe(true);
    expect(acceptsManualEntries("retained_earnings")).toBe(true);
    expect(acceptsManualEntries("cash")).toBe(false);
    expect(acceptsManualEntries("advances_received")).toBe(false);
  });
});

describe("assembleBalance", () => {
  const article = (over: Partial<BalanceArticleInput> & Pick<BalanceArticleInput, "id" | "category">): BalanceArticleInput => ({
    name: over.id,
    systemCode: null,
    entries: d(0),
    linkedFlows: d(0),
    ...over,
  });

  // Capital 10 000 paid in, loan 500 000 received and 50 000 repaid, equipment bought for 100 000,
  // customer prepaid 30 000, unpaid invoice 200 000, unpaid payroll accrual 65 100.
  const input = {
    cash: d(390000),
    receivable: d(200000),
    payable: d(0),
    payrollPayable: d(65100),
    advancesIssued: d(0),
    advancesReceived: d(30000),
    netProfitFromPnl: d(134900),
    articles: [
      article({ id: "Прочие активы", category: "ASSET", linkedFlows: d(100000) }),
      article({ id: "Займы и кредиты", category: "LIABILITY", linkedFlows: d(450000) }),
      article({ id: "Капитал", category: "EQUITY", linkedFlows: d(10000) }),
      article({ id: "Нераспределённая прибыль", category: "EQUITY", systemCode: "retained_earnings" }),
      article({ id: "Денежные средства", category: "ASSET", systemCode: "cash" }),
    ],
  };

  it("balances when every movement is accounted for", () => {
    const b = assembleBalance(input);
    expect(b.totalAssets.toNumber()).toBe(690000);
    expect(b.totalLiabilities.toNumber()).toBe(545100);
    expect(b.totalEquity.toNumber()).toBe(144900);
    expect(b.isBalanced).toBe(true);
    expect(b.assetArticles.map((a) => a.name)).toEqual(["Прочие активы"]); // derived system lines are not duplicated
  });

  it("adds an opening retained-earnings entry to the P&L result", () => {
    const b = assembleBalance({
      ...input,
      cash: d(440000),
      articles: input.articles.map((a) => (a.systemCode === "retained_earnings" ? { ...a, entries: d(50000) } : a)),
    });
    expect(b.retainedEarnings.toNumber()).toBe(184900);
    expect(b.isBalanced).toBe(true);
  });

  it("shows a discrepancy for money that moved without a document or balance article", () => {
    const b = assembleBalance({ ...input, cash: d(389500) }); // a 500 bank fee without a counterparty
    expect(b.discrepancy.toNumber()).toBe(-500);
    expect(b.isBalanced).toBe(false);
  });
});

describe("allocatedAsOf", () => {
  const utc = (m: number, day: number) => new Date(Date.UTC(2026, m - 1, day));
  const allocations = [
    // Prepayment on 5 Sep for an invoice dated 20 Sep: an advance until the 20th.
    { amount: d(30000), paymentDate: utc(9, 5), documentDate: utc(9, 20) },
    // Invoice of 1 Sep paid on 10 Sep: unpaid until the 10th.
    { amount: d(50000), paymentDate: utc(9, 10), documentDate: utc(9, 1) },
  ];

  it("counts an allocation from the later of the payment and document dates", () => {
    expect(allocatedAsOf(allocations, utc(9, 9)).toNumber()).toBe(0);
    expect(allocatedAsOf(allocations, utc(9, 10)).toNumber()).toBe(50000);
    expect(allocatedAsOf(allocations, utc(9, 19)).toNumber()).toBe(50000);
    expect(allocatedAsOf(allocations, utc(9, 20)).toNumber()).toBe(80000);
  });
});

describe("accrued lines", () => {
  it("adds depreciation and interest to their system lines and keeps the balance equal", () => {
    // Equipment 120 000 paid in cash, 10 000 depreciated; loan 100 000 with 1 000 interest accrued, 400 paid.
    const b = assembleBalance({
      cash: d(100000 - 120000 - 400),
      receivable: d(0),
      payable: d(0),
      payrollPayable: d(0),
      advancesIssued: d(0),
      advancesReceived: d(0),
      netProfitFromPnl: d(-11000),
      articles: [
        { id: "eq", name: "Основные средства", category: "ASSET", systemCode: null, entries: d(0), linkedFlows: d(120000) },
        { id: "dep", name: "Накопленная амортизация", category: "ASSET", systemCode: "accumulated_depreciation", entries: d(0), linkedFlows: d(0), accrued: d(-10000) },
        { id: "loan", name: "Кредит", category: "LIABILITY", systemCode: null, entries: d(0), linkedFlows: d(100000) },
        { id: "int", name: "Проценты к уплате", category: "LIABILITY", systemCode: "interest_payable", entries: d(0), linkedFlows: d(-400), accrued: d(1000) },
      ],
    });
    expect(b.assetArticles.map((a) => [a.id, a.amount.toNumber()])).toEqual([["eq", 120000], ["dep", -10000]]);
    expect(b.liabilityArticles.map((a) => [a.id, a.amount.toNumber()])).toEqual([["loan", 100000], ["int", 600]]);
    expect(b.isBalanced).toBe(true);
    expect(acceptsManualEntries("accumulated_depreciation")).toBe(true);
    expect(acceptsManualEntries("interest_payable")).toBe(true);
  });
});
