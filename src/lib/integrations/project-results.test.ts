import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import { computeProjectResult, projectResultPayload, type ProjectResultDocument } from "./project-results";

const d = (v: number) => toDecimal(v);
const doc = (direction: "INCOME" | "EXPENSE", total: number, allocated: number, lines: Array<[number, string]>): ProjectResultDocument => ({
  direction,
  total: d(total),
  allocated: d(allocated),
  projectLines: lines.map(([amount, pnlType]) => ({ amount: d(amount), pnlType })),
});

describe("computeProjectResult", () => {
  // A: invoice 300 000, of which 200 000 is this project, half paid → 2/3 of the payment belongs to the project.
  const documents = [
    doc("INCOME", 300000, 150000, [[200000, "REVENUE"]]),
    doc("EXPENSE", 50000, 50000, [[50000, "DIRECT_VARIABLE"]]),
    doc("EXPENSE", 10000, 0, [[10000, "INDIRECT"]]),
    doc("INCOME", 5000, 0, [[5000, "OTHER_INCOME"]]),
  ];

  it("counts only what is attributed to the project and the result after its direct and other costs", () => {
    const r = computeProjectResult(documents);
    expect([r.revenue, r.otherIncome, r.directCosts, r.otherCosts].map((x) => x.toNumber())).toEqual([200000, 5000, 50000, 10000]);
    expect(r.grossProfit.toNumber()).toBe(150000);
    expect(r.financialResult.toNumber()).toBe(145000);
    expect(r.marginPct?.toNumber()).toBe(72.5);
    expect(r.documents).toBe(4);
  });

  it("splits payments between projects by their share of the document", () => {
    const r = computeProjectResult(documents);
    expect(r.receivedFromCustomers.toNumber()).toBe(100000);
    expect(r.receivable.toNumber()).toBe(105000);
    expect(r.paidToSuppliers.toNumber()).toBe(50000);
    expect(r.payable.toNumber()).toBe(10000);
  });

  it("caps an overpayment at the document total and has no margin without revenue", () => {
    const r = computeProjectResult([doc("EXPENSE", 1000, 1500, [[1000, "DIRECT_FIXED"]])]);
    expect([r.paidToSuppliers.toNumber(), r.payable.toNumber()]).toEqual([1000, 0]);
    expect(r.marginPct).toBeNull();
    expect(r.financialResult.toNumber()).toBe(-1000);
  });
});

describe("projectResultPayload", () => {
  it("sends money as fixed two-decimal strings together with the deal ID", () => {
    const payload = projectResultPayload(
      { id: "p1", name: "Проект А", code: "PA", bitrixDealId: "1234" },
      computeProjectResult([doc("INCOME", 1000, 250, [[1000, "REVENUE"]])]),
    );
    expect(payload).toMatchObject({
      bitrixDealId: "1234",
      revenue: "1000.00",
      financialResult: "1000.00",
      marginPct: "100.00",
      receivedFromCustomers: "250.00",
      receivable: "750.00",
      currency: "RUB",
    });
  });
});
