import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import {
  acceptsManualEntries,
  advanceFromTransaction,
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
