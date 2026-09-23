import { describe, expect, it } from "vitest";
import { computeFingerprint, computeStatementFingerprints, type FingerprintInput } from "./fingerprint";

const fee: FingerprintInput = {
  bankAccountId: "acc-1",
  operationDate: new Date(Date.UTC(2026, 8, 1)),
  direction: "OUTFLOW",
  amount: "150.00",
  purpose: "Комиссия за перевод",
};
const payment: FingerprintInput = { ...fee, amount: "50000.00", purpose: "Оплата по счёту 12" };

const prints = (rows: FingerprintInput[]) => computeStatementFingerprints(rows).map((r) => r.fingerprint);

describe("computeStatementFingerprints", () => {
  it("keeps two identical operations without a bank reference apart", () => {
    const [first, second] = computeStatementFingerprints([fee, fee]);
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect([first.occurrence, second.occurrence]).toEqual([1, 2]);
  });

  it("gives the first occurrence the plain fingerprint, compatible with earlier imports and manual entry", () => {
    expect(prints([fee])[0]).toBe(computeFingerprint(fee));
  });

  it("is stable on re-import of the same file, so duplicates are still detected", () => {
    expect(prints([fee, payment, fee])).toEqual(prints([fee, payment, fee]));
  });

  it("matches an overlapping statement by occurrence, regardless of unrelated rows around it", () => {
    const early = prints([fee]); // statement cut mid-day: one fee so far
    const full = prints([payment, fee, fee]); // full day later: both fees
    expect(full[1]).toBe(early[0]); // the known fee is a duplicate
    expect(early).not.toContain(full[2]); // the second fee is new
  });

  it("treats the same bank reference twice as one operation", () => {
    const withRef = { ...fee, externalRef: "OP-77" };
    const result = computeStatementFingerprints([withRef, withRef]);
    expect(result[0].fingerprint).toBe(result[1].fingerprint);
    expect(result[1].occurrence).toBe(1);
  });

  it("numbers per account and direction independently", () => {
    const other = prints([fee, { ...fee, bankAccountId: "acc-2" }, { ...fee, direction: "INFLOW" }]);
    expect(other[1]).toBe(computeFingerprint({ ...fee, bankAccountId: "acc-2" }));
    expect(other[2]).toBe(computeFingerprint({ ...fee, direction: "INFLOW" }));
  });
});
