import { describe, expect, it } from "vitest";
import {
  allocationDocumentSide,
  allocationTransactionSide,
  documentTotal,
  lineAmounts,
  outstanding,
  parseRate,
  planAllocation,
  realizedFx,
  revaluedRemaining,
  toRubAtRate,
} from "./currency";
import { computePaymentStatus } from "@/lib/matching";

const d = (v: string | number) => String(v);

describe("document amounts", () => {
  it("keeps the currency amounts and books roubles at the document rate", () => {
    expect(lineAmounts({ amount: 1000, vatAmount: 200 }, null)).toEqual({ amount: 1000, vatAmount: 200, currencyAmount: null, currencyVatAmount: null });
    const usd = lineAmounts({ amount: 1000, vatAmount: 166.67 }, parseRateValue("84.0954"));
    expect(usd).toEqual({ amount: 84095.4, vatAmount: 14016.18, currencyAmount: 1000, currencyVatAmount: 166.67 });
  });

  it("reads a rate from the form", () => {
    expect(parseRate("")).toEqual({ rate: null });
    expect("rate" in parseRate("84,0954") && parseRate("84,0954")).toMatchObject({ rate: expect.anything() });
    expect(parseRate("-1")).toHaveProperty("error");
    expect(parseRate("84.1234567")).toHaveProperty("error");
  });

  it("totals a document in its own currency", () => {
    const lines = [{ amount: "84095.40", currencyAmount: "1000" }, { amount: "8409.54", currencyAmount: "100" }];
    expect(documentTotal(lines, true).toNumber()).toBe(1100);
    expect(documentTotal(lines, false).toNumber()).toBe(92504.94);
  });
});

function parseRateValue(text: string) {
  const r = parseRate(text);
  if (!("rate" in r) || !r.rate) throw new Error("rate");
  return r.rate;
}

describe("planAllocation", () => {
  it("same currency: roubles as before, a foreign document at its own rate", () => {
    expect(planAllocation({ entered: "500", transactionCurrency: "RUB", documentCurrency: "RUB", documentRate: null, paymentDayRate: null })).toEqual({
      amount: expect.objectContaining({}),
      currencyAmount: null,
      transactionAmount: null,
    });
    const usd = planAllocation({ entered: "400", transactionCurrency: "USD", documentCurrency: "USD", documentRate: "80", paymentDayRate: null });
    expect("amount" in usd && [usd.amount.toFixed(2), usd.currencyAmount?.toFixed(2), usd.transactionAmount?.toFixed(2)]).toEqual(["32000.00", "400.00", "400.00"]);
  });

  it("a rouble payment of a document in «у.е.» converts at the payment day rate", () => {
    const r = planAllocation({ entered: "42500", transactionCurrency: "RUB", documentCurrency: "USD", documentRate: "80", paymentDayRate: "85" });
    // 42 500 ₽ / 85 = 500 $ of the document; booked 500 × 80 = 40 000 ₽.
    expect("amount" in r && [r.amount.toFixed(2), r.currencyAmount?.toFixed(2), r.transactionAmount?.toFixed(2)]).toEqual(["40000.00", "500.00", "42500.00"]);
  });

  it("a foreign payment of a rouble document converts to roubles; two foreign currencies are refused", () => {
    const r = planAllocation({ entered: "100", transactionCurrency: "USD", documentCurrency: "RUB", documentRate: null, paymentDayRate: "85" });
    expect("amount" in r && [r.amount.toFixed(2), r.currencyAmount, r.transactionAmount?.toFixed(2)]).toEqual(["8500.00", null, "100.00"]);
    expect(planAllocation({ entered: "100", transactionCurrency: "USD", documentCurrency: "EUR", documentRate: "95", paymentDayRate: "85" })).toEqual({
      error: "Платёж в USD нельзя сопоставить с документом в EUR — валюты разные",
    });
    expect(planAllocation({ entered: "100", transactionCurrency: "RUB", documentCurrency: "USD", documentRate: "80", paymentDayRate: null })).toHaveProperty("error");
  });

  it("each side of an allocation is read in its own currency", () => {
    const a = { amount: "40000", currencyAmount: "500", transactionAmount: "42500" };
    expect(allocationDocumentSide(a).toNumber()).toBe(500);
    expect(allocationTransactionSide(a).toNumber()).toBe(42500);
    expect(allocationDocumentSide({ amount: "100" }).toNumber()).toBe(100);
    // A document in dollars fully paid in roubles at a different rate is paid in full.
    expect(computePaymentStatus("500", allocationDocumentSide(a).toString())).toBe("PAID");
  });
});

describe("FX differences", () => {
  it("realized: received more roubles on income is a gain, paid more on an expense is a loss", () => {
    expect(realizedFx("INCOME", "42500", "40000").toNumber()).toBe(2500);
    expect(realizedFx("EXPENSE", "42500", "40000").toNumber()).toBe(-2500);
  });

  it("unrealized: the unpaid remainder at the report date rate", () => {
    const r = revaluedRemaining("INCOME", "500", "80", "84.4075");
    expect(r.revalued.toFixed(2)).toBe("42203.75");
    expect(r.difference.toFixed(2)).toBe("2203.75");
    expect(revaluedRemaining("EXPENSE", "500", "80", "84.4075").difference.toFixed(2)).toBe("-2203.75");
  });

  it("the outstanding remainder of a document, in its currency and in roubles", () => {
    const doc = {
      currency: "USD",
      exchangeRate: "80",
      lines: [{ amount: "80000", currencyAmount: "1000" }],
      allocations: [{ amount: "40000", currencyAmount: "500" }],
    };
    const left = outstanding(doc, "84");
    expect([left.native.toNumber(), left.rub.toNumber()]).toEqual([500, 42000]);
    expect(outstanding(doc, null).rub.toNumber()).toBe(40000);
    const rub = outstanding({ currency: "RUB", exchangeRate: null, lines: [{ amount: "1000" }], allocations: [{ amount: "300" }] }, null);
    expect([rub.native.toNumber(), rub.rub.toNumber()]).toEqual([700, 700]);
    expect(toRubAtRate(d("0.005"), d("1")).toFixed(2)).toBe("0.01");
  });
});
