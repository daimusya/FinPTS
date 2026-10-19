import { describe, expect, it } from "vitest";
import { duplicateSearchRange, isPossibleDuplicate, matchDuplicates, type DuplicateCandidate } from "./duplicates";

const req = (id: string, over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id,
  organizationId: "org",
  counterpartyId: "cp",
  amount: "15000.00",
  currency: "RUB",
  dueDate: new Date("2026-10-20T00:00:00Z"),
  status: "PENDING_APPROVAL",
  ...over,
});

describe("isPossibleDuplicate", () => {
  it("same payee, amount and currency within two weeks — including an already paid one", () => {
    expect(isPossibleDuplicate(req("a"), req("b", { dueDate: new Date("2026-10-30T00:00:00Z") }))).toBe(true);
    expect(isPossibleDuplicate(req("a"), req("b", { status: "PAID", amount: "15000" }))).toBe(true);
  });
  it("not a duplicate: itself, another payee, amount, currency or organization, no payee, too far apart, cancelled or rejected", () => {
    expect(isPossibleDuplicate(req("a"), req("a"))).toBe(false);
    expect(isPossibleDuplicate(req("a"), req("b", { counterpartyId: "other" }))).toBe(false);
    expect(isPossibleDuplicate(req("a"), req("b", { amount: "15000.01" }))).toBe(false);
    expect(isPossibleDuplicate(req("a"), req("b", { currency: "USD" }))).toBe(false);
    expect(isPossibleDuplicate(req("a"), req("b", { organizationId: "org2" }))).toBe(false);
    expect(isPossibleDuplicate(req("a", { counterpartyId: null }), req("b", { counterpartyId: null }))).toBe(false);
    // Monthly rent of the same amount is not a duplicate.
    expect(isPossibleDuplicate(req("a"), req("b", { dueDate: new Date("2026-11-20T00:00:00Z") }))).toBe(false);
    expect(isPossibleDuplicate(req("a"), req("b", { status: "CANCELLED" }))).toBe(false);
    expect(isPossibleDuplicate(req("a"), req("b", { status: "REJECTED" }))).toBe(false);
  });
});

describe("matchDuplicates", () => {
  it("warns only where a decision or payment is still ahead", () => {
    const all = [req("a"), req("b", { status: "PAID" }), req("c", { status: "APPROVED" })];
    const map = matchDuplicates(all, all);
    expect(map.get("a")?.map((r) => r.id)).toEqual(["b", "c"]);
    expect(map.get("c")?.map((r) => r.id)).toEqual(["a", "b"]);
    expect(map.has("b")).toBe(false);
  });
  it("search range spans the subjects' due dates plus the window", () => {
    expect(duplicateSearchRange([])).toBeNull();
    const range = duplicateSearchRange([req("a"), req("b", { dueDate: new Date("2026-11-01T00:00:00Z") })])!;
    expect(range.from.toISOString().slice(0, 10)).toBe("2026-10-06");
    expect(range.to.toISOString().slice(0, 10)).toBe("2026-11-15");
  });
});
