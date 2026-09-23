import { describe, expect, it } from "vitest";
import { toDecimal } from "@/lib/money";
import { UNRESTRICTED_SCOPE } from "@/lib/access-scope";
import {
  isFavorable,
  mergePlanIntoRows,
  parseBudgetAmount,
  planFactMetrics,
  planTotal,
  resolvePlanAvailability,
  type PlanItem,
} from "./plan-fact";

const d = (v: number | string) => toDecimal(v);

describe("planFactMetrics", () => {
  it("computes deviation and execution percent", () => {
    const m = planFactMetrics(d(80000), d(100000));
    expect(m.deviation?.toNumber()).toBe(-20000);
    expect(m.executionPct?.toNumber()).toBe(80);
  });

  it("has no metrics without a plan and no percent for a zero plan", () => {
    expect(planFactMetrics(d(5), null)).toEqual({ plan: null, deviation: null, executionPct: null });
    const zero = planFactMetrics(d(5), d(0));
    expect(zero.deviation?.toNumber()).toBe(5);
    expect(zero.executionPct).toBeNull();
  });
});

describe("isFavorable", () => {
  it("reads overperformance as good for income and bad for expenses", () => {
    expect(isFavorable(d(100), "income")).toBe(true);
    expect(isFavorable(d(100), "expense")).toBe(false);
    expect(isFavorable(d(-100), "expense")).toBe(true);
    expect(isFavorable(d(0), "income")).toBeNull();
    expect(isFavorable(null, "income")).toBeNull();
  });
});

describe("mergePlanIntoRows", () => {
  const plan: PlanItem[] = [
    { articleId: "rent", articleName: "Аренда", group: "OUTFLOW", amount: d(50000) },
    { articleId: "ads", articleName: "Реклама", group: "OUTFLOW", amount: d(20000) },
  ];

  it("attaches the plan to fact rows and adds planned articles that have no fact yet", () => {
    const rows = mergePlanIntoRows(
      [
        { articleId: "rent", articleName: "Аренда", amount: d(50000), count: 1 },
        { articleId: null, articleName: "Без статьи", amount: d(700), count: 2 },
      ],
      plan,
      (item) => ({ articleId: item.articleId, articleName: item.articleName, amount: d(0), count: 0 }),
    );
    expect(rows.map((r) => [r.articleName, r.amount.toNumber(), r.plan?.toNumber() ?? null, r.count])).toEqual([
      ["Аренда", 50000, 50000, 1],
      ["Без статьи", 700, null, 2],
      ["Реклама", 0, 20000, 0],
    ]);
    expect(rows[2].deviation?.toNumber()).toBe(-20000);
  });
});

describe("planTotal", () => {
  it("sums one section and returns null for a section without plan", () => {
    const plan: PlanItem[] = [
      { articleId: "a", articleName: "A", group: "REVENUE", amount: d("100.50") },
      { articleId: "b", articleName: "B", group: "REVENUE", amount: d(200) },
    ];
    expect(planTotal(plan, "REVENUE")?.toNumber()).toBe(300.5);
    expect(planTotal(plan, "TAX")).toBeNull();
  });
});

describe("resolvePlanAvailability", () => {
  it("uses all plan entries for an unfiltered, unrestricted report", () => {
    expect(resolvePlanAvailability({}, UNRESTRICTED_SCOPE)).toEqual({ available: true, organizationIds: null });
  });

  it("uses only the selected organization's plan", () => {
    expect(resolvePlanAvailability({ organizationId: "org-1" }, UNRESTRICTED_SCOPE)).toEqual({
      available: true,
      organizationIds: ["org-1"],
    });
  });

  it("limits the plan to the organizations a restricted user can see", () => {
    const scope = { organizationIds: ["org-2"], departmentIds: null, projectIds: null };
    expect(resolvePlanAvailability({}, scope)).toEqual({ available: true, organizationIds: ["org-2"] });
  });

  it("hides the plan when the fact is only a slice of an article", () => {
    expect(resolvePlanAvailability({ projectId: "p" }, UNRESTRICTED_SCOPE).available).toBe(false);
    expect(resolvePlanAvailability({ counterpartyId: "c" }, UNRESTRICTED_SCOPE).available).toBe(false);
    const deptScope = { organizationIds: null, departmentIds: ["d"], projectIds: null };
    expect(resolvePlanAvailability({}, deptScope).available).toBe(false);
  });
});

describe("parseBudgetAmount", () => {
  it("accepts spaces, a comma and kopecks; empty means no plan", () => {
    expect(parseBudgetAmount("1 500,50").value?.toNumber()).toBe(1500.5);
    expect(parseBudgetAmount(" ").value).toBeNull();
    expect(parseBudgetAmount("0").value?.toNumber()).toBe(0);
  });

  it("rejects text, extra decimals and negative amounts", () => {
    expect(parseBudgetAmount("abc").error).toBeDefined();
    expect(parseBudgetAmount("1.234").error).toBeDefined();
    expect(parseBudgetAmount("-5").error).toContain("отрицательной");
  });
});
