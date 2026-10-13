import { describe, expect, it } from "vitest";
import { payeeChangedSince } from "./payee-change";

const at = (s: string) => new Date(`2026-10-${s}Z`);
const approved = (day: string, round = 1) => ({ decision: "approved", round, decidedAt: at(day) });

describe("payeeChangedSince", () => {
  it("flags bank details changed after the first approval of the round", () => {
    expect(payeeChangedSince(at("12T12:00:00"), [approved("10T09:00:00"), approved("11T09:00:00")], 1)).toEqual(at("10T09:00:00"));
  });
  it("no warning when details are older, nobody approved yet, or approvals belong to an earlier round", () => {
    expect(payeeChangedSince(at("09T12:00:00"), [approved("10T09:00:00")], 1)).toBeNull();
    expect(payeeChangedSince(at("12T12:00:00"), [], 1)).toBeNull();
    expect(payeeChangedSince(at("12T12:00:00"), [approved("10T09:00:00", 1)], 2)).toBeNull();
    expect(payeeChangedSince(at("12T12:00:00"), [{ decision: "returned", round: 1, decidedAt: at("10T09:00:00") }], 1)).toBeNull();
    expect(payeeChangedSince(null, [approved("10T09:00:00")], 1)).toBeNull();
  });
});
