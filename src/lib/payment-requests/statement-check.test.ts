import { describe, expect, it } from "vitest";
import { checkStatement, matchStatement, requestApprovedAt, type CheckedRequest, type StatementOutflow } from "./statement-check";

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
  it("leaves a statement debit unassigned when several requests could be closed by it", () => {
    const approved = req("approved", { status: "APPROVED" });
    const alreadyPaid = req("paid");
    const debit = out("debit");
    expect(matchStatement([debit], [approved], { requireUniqueRequest: true }).matches).toHaveLength(1);
    expect(matchStatement([debit], [approved, alreadyPaid], { requireUniqueRequest: true }).matches).toEqual([]);
  });

  it("reserves a manually matched debit and part for each other", () => {
    const first = req("first", { slots: [{ key: "p1", amount: "15000", dueDate: d("2026-10-21"), paid: false, statementTransactionId: "manual" }] });
    const second = req("second", { slots: [{ key: "p2", amount: "15000", dueDate: d("2026-10-21"), paid: false }] });
    const manual = out("manual", { matchedPartId: "p1" });
    const other = out("other");
    expect(matchStatement([manual, other], [second, first], { requireUniqueRequest: true }).matches
      .map(({ outflow, slotKey }) => [outflow.id, slotKey])).toEqual([["manual", "first:p1"], ["other", "second:p2"]]);
    expect(matchStatement([manual], [second]).matches).toEqual([]);
  });

  it("returns an unlinked debit to manual review even if only one request fits", () => {
    const request = req("r", { status: "APPROVED" });
    const debit = out("unlinked", { requiresManualRequestMatch: true });
    const result = checkStatement([debit], [request], { requireUniqueRequest: true });
    expect([...result.ambiguousOutflows]).toEqual([debit.id]);
    expect(result.withoutRequest).toEqual([]);
    expect(matchStatement([debit], [request], { requireUniqueRequest: true }).matches).toEqual([]);
  });

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

  it("reconciles a split request as a whole or in parts without consuming both", () => {
    const request = req("r", { slots: [
      { key: "whole", amount: "15000", dueDate: d("2026-10-20"), paid: false },
      { key: "first", amount: "5000", dueDate: d("2026-10-22"), paid: false },
      { key: "second", amount: "10000", dueDate: d("2026-10-23"), paid: false },
    ] });
    const full = out("full");
    const first = out("first", { amount: "5000", operationDate: d("2026-10-24") });
    const second = out("second", { amount: "10000", operationDate: d("2026-10-24") });
    expect(matchStatement([full, first, second], [request]).matches.map((match) => match.slotKey)).toEqual(["r:whole"]);
    expect(matchStatement([first], [request]).matches.map((match) => match.slotKey)).toEqual(["r:first"]);
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
