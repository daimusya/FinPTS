import { describe, expect, it } from "vitest";
import { checkAllocation } from "./allocation";

const base = {
  transactionDirection: "INFLOW" as const,
  isTransfer: false,
  documentDirection: "INCOME" as const,
  documentStatus: "POSTED",
  entered: "300",
  transactionAmount: "1000",
  alreadyAllocated: "600",
};

describe("checkAllocation", () => {
  it("accepts a receipt against an income document within the unallocated remainder", () => {
    expect(checkAllocation(base)).toBeNull();
    expect(checkAllocation({ ...base, entered: "400" })).toBeNull();
    expect(checkAllocation({ ...base, transactionDirection: "OUTFLOW", documentDirection: "EXPENSE" })).toBeNull();
  });

  it("refuses more than the operation still has", () => {
    expect(checkAllocation({ ...base, entered: "400.01" })).toBe(
      "Сумма больше несопоставленного остатка операции (400.00) — нельзя сопоставить больше, чем прошло по счёту",
    );
  });

  it("refuses a wrong direction, a draft or cancelled document and an own-account transfer", () => {
    expect(checkAllocation({ ...base, documentDirection: "EXPENSE" })).toMatch(/Поступление гасит только документ дохода/);
    expect(checkAllocation({ ...base, transactionDirection: "OUTFLOW" })).toMatch(/Списание гасит только документ расхода/);
    expect(checkAllocation({ ...base, documentStatus: "DRAFT" })).toMatch(/проведённым/);
    expect(checkAllocation({ ...base, documentStatus: "CANCELLED" })).toMatch(/проведённым/);
    expect(checkAllocation({ ...base, isTransfer: true })).toMatch(/Перевод между собственными счетами/);
  });
});
