import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { computeTaxes, splitByProjectShares } from "./calculate";

function d(n: number) {
  return new Decimal(n);
}

describe("computeTaxes", () => {
  const rates = { ndflPct: d(13), insurancePct: d(30.2) };

  it("computes NDFL and insurance when both apply", () => {
    const result = computeTaxes(d(1000), true, true, rates);
    expect(result.ndflAmount.toNumber()).toBe(130);
    expect(result.insuranceAmount.toNumber()).toBe(302);
  });

  it("returns zero for taxes that do not apply to this accrual type", () => {
    const result = computeTaxes(d(1000), false, false, rates);
    expect(result.ndflAmount.toNumber()).toBe(0);
    expect(result.insuranceAmount.toNumber()).toBe(0);
  });

  it("applies only NDFL when insurance does not apply (e.g. sick leave)", () => {
    const result = computeTaxes(d(1000), true, false, rates);
    expect(result.ndflAmount.toNumber()).toBe(130);
    expect(result.insuranceAmount.toNumber()).toBe(0);
  });
});

describe("splitByProjectShares", () => {
  it("puts 100% on the employee's department when there are no project shares", () => {
    const result = splitByProjectShares(d(1000), [], "dept1");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ projectId: null, departmentId: "dept1", amount: d(1000) });
  });

  it("splits proportionally across project shares that sum to 100", () => {
    const result = splitByProjectShares(
      d(1000),
      [
        { projectId: "p1", sharePct: d(60) },
        { projectId: "p2", sharePct: d(40) },
      ],
      "dept1",
    );
    expect(result[0].amount.toNumber()).toBe(600);
    expect(result[1].amount.toNumber()).toBe(400);
  });

  it("the last split absorbs rounding remainder so amounts sum exactly to the total", () => {
    const result = splitByProjectShares(
      d(100),
      [
        { projectId: "p1", sharePct: d(33.33) },
        { projectId: "p2", sharePct: d(33.33) },
        { projectId: "p3", sharePct: d(33.34) },
      ],
      "dept1",
    );
    const sum = result.reduce((acc, r) => acc.plus(r.amount), new Decimal(0));
    expect(sum.toNumber()).toBe(100);
  });

  it("handles shares that do not sum to 100 by normalizing proportionally", () => {
    const result = splitByProjectShares(
      d(1000),
      [
        { projectId: "p1", sharePct: d(50) },
        { projectId: "p2", sharePct: d(50) },
      ],
      "dept1",
    );
    const sum = result.reduce((acc, r) => acc.plus(r.amount), new Decimal(0));
    expect(sum.toNumber()).toBe(1000);
  });
});
