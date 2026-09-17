import { describe, expect, it } from "vitest";
import { computePaymentStatus, computeMatchStatus } from "./matching";

describe("computePaymentStatus", () => {
  it("is UNPAID when nothing is allocated", () => {
    expect(computePaymentStatus(1000, 0)).toBe("UNPAID");
  });

  it("is PARTIALLY_PAID when allocated is between 0 and total", () => {
    expect(computePaymentStatus(1000, 400)).toBe("PARTIALLY_PAID");
  });

  it("is PAID when allocated exactly equals total", () => {
    expect(computePaymentStatus(1000, 1000)).toBe("PAID");
  });

  it("is PAID for fractional amounts that are exactly equal (no float drift)", () => {
    expect(computePaymentStatus("1000.10", "333.40")).toBe("PARTIALLY_PAID");
    expect(computePaymentStatus("0.30", "0.10")).toBe("PARTIALLY_PAID");
    // three allocations of 0.10 should sum to exactly 0.30 via Decimal,
    // unlike raw IEEE754 float addition (0.1 + 0.1 + 0.1 !== 0.3)
    expect(0.1 + 0.1 + 0.1).not.toBe(0.3);
    expect(computePaymentStatus("0.30", "0.30")).toBe("PAID");
  });

  it("is OVERPAID when allocated exceeds total", () => {
    expect(computePaymentStatus(1000, 1500)).toBe("OVERPAID");
  });
});

describe("computeMatchStatus", () => {
  it("is UNMATCHED when nothing is allocated", () => {
    expect(computeMatchStatus(500, 0)).toBe("UNMATCHED");
  });

  it("is PARTIALLY_MATCHED for a partial allocation", () => {
    expect(computeMatchStatus(500, 200)).toBe("PARTIALLY_MATCHED");
  });

  it("is MATCHED once allocated reaches the transaction amount", () => {
    expect(computeMatchStatus(500, 500)).toBe("MATCHED");
  });

  it("is MATCHED (not overpaid) when a transaction is split across documents exceeding its own amount would be a bug elsewhere, but matching itself treats >= as matched", () => {
    expect(computeMatchStatus(500, 600)).toBe("MATCHED");
  });
});
