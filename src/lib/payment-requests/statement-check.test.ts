import { describe, expect, it } from "vitest";
import { checkStatement, requestApprovedAt, type CheckedRequest, type StatementOutflow } from "./statement-check";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const out = (id: string, over: Partial<StatementOutflow> = {}): StatementOutflow => ({
  id,
  organizationId: "org",
  counterpartyId: "cp",
  amount: "15000.00",
  currency: "RUB",
  operationDate: d("2026-10-20"),
  ...over,
});
const req = (id: string, over: Partial<CheckedRequest> = {}): CheckedRequest => ({
  id,
  organizationId: "org",
  counterpartyId: "cp",
  currency: "RUB",
  status: "PAID",
  approvedAt: new Date("2026-10-18T09:00:00Z"),
  slots: [{ key: "whole", amount: "15000", dueDate: d("2026-10-21"), paid: true }],
  ...over,
});
const ids = (r: ReturnType<typeof checkStatement>) => ({
  without: r.withoutRequest.map((o) => o.id),
  before: r.beforeApproval.map((m) => `${m.outflow.id}>${m.request.id}`),
  notMarked: r.notMarked.map((m) => `${m.outflow.id}>${m.request.id}`),
  ok: r.inOrder,
});

describe("checkStatement", () => {
  it("a paid, approved request explains its outflow", () => {
    expect(ids(checkStatement([out("t")], [req("r")]))).toEqual({ without: [], before: [], notMarked: [], ok: 1 });
  });
  it("an outflow nobody requested — another payee, amount, currency, organization or too far from the due date", () => {
    for (const r of [
      req("r", { counterpartyId: "x" }),
      req("r", { slots: [{ key: "whole", amount: "15000.01", dueDate: d("2026-10-21"), paid: true }] }),
      req("r", { currency: "USD" }),
      req("r", { organizationId: "org2" }),
      req("r", { slots: [{ key: "whole", amount: "15000", dueDate: d("2026-12-01"), paid: true }] }),
    ]) {
      expect(ids(checkStatement([out("t")], [r])).without).toEqual(["t"]);
    }
  });
  it("one request explains one outflow: a second payment of the same invoice is without a request", () => {
    expect(ids(checkStatement([out("t1"), out("t2", { operationDate: d("2026-10-23") })], [req("r")]))).toEqual({
      without: ["t2"],
      before: [],
      notMarked: [],
      ok: 1,
    });
  });
  it("paid before approval: still pending, rejected, or approved only after the payment day", () => {
    expect(ids(checkStatement([out("t")], [req("r", { status: "PENDING_APPROVAL", approvedAt: null })])).before).toEqual(["t>r"]);
    expect(ids(checkStatement([out("t")], [req("r", { status: "REJECTED", approvedAt: null })])).before).toEqual(["t>r"]);
    expect(ids(checkStatement([out("t")], [req("r", { approvedAt: new Date("2026-10-21T08:00:00Z") })])).before).toEqual(["t>r"]);
    // Approved late in the evening by Moscow time of the payment day — in time.
    expect(ids(checkStatement([out("t")], [req("r", { approvedAt: new Date("2026-10-20T19:00:00Z") })])).ok).toBe(1);
  });
  it("approved and paid by the statement, but not marked paid", () => {
    const r = req("r", { status: "APPROVED", slots: [{ key: "whole", amount: "15000", dueDate: d("2026-10-21"), paid: false }] });
    expect(ids(checkStatement([out("t")], [r])).notMarked).toEqual(["t>r"]);
  });
  it("parts of a schedule are matched one by one; an approved request wins over a pending one", () => {
    const parts = req("r", {
      status: "APPROVED",
      approvedAt: d("2026-10-01"),
      slots: [
        { key: "p1", amount: "5000", dueDate: d("2026-10-10"), paid: true },
        { key: "p2", amount: "5000", dueDate: d("2026-10-25"), paid: false },
      ],
    });
    const pending = req("q", { status: "PENDING_APPROVAL", approvedAt: null, slots: [{ key: "whole", amount: "5000", dueDate: d("2026-10-11"), paid: false }] });
    const result = ids(checkStatement([out("a", { amount: "5000", operationDate: d("2026-10-11") }), out("b", { amount: "5000", operationDate: d("2026-10-24") })], [parts, pending]));
    expect(result).toEqual({ without: [], before: [], notMarked: ["b>r"], ok: 1 });
  });
});

describe("requestApprovedAt", () => {
  it("the last approval of the current round, only for approved or paid requests", () => {
    const decisions = [
      { decision: "approved", round: 1, decidedAt: d("2026-10-01") },
      { decision: "approved", round: 2, decidedAt: d("2026-10-05") },
      { decision: "approved", round: 2, decidedAt: d("2026-10-06") },
    ];
    expect(requestApprovedAt("APPROVED", 2, decisions)).toEqual(d("2026-10-06"));
    expect(requestApprovedAt("PENDING_APPROVAL", 2, decisions)).toBeNull();
    expect(requestApprovedAt("PAID", 3, decisions)).toBeNull();
  });
});
