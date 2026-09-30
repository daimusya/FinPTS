import { describe, expect, it } from "vitest";
import {
  checkTransactionDeletion,
  checkTransactionEdit,
  deletedByBatch,
  parseTransactionEdit,
  planBulkDeletion,
  type BulkDeletionLeg,
  type EditableLeg,
  type TransactionEditInput,
} from "./transaction-edit";

const form = (values: Record<string, string>) => (name: string) => values[name];

describe("parseTransactionEdit", () => {
  const base = { bankAccountId: "b1", operationDate: "2026-09-15", direction: "OUTFLOW", amount: "1 250,5", purpose: "  Аренда  " };

  it("normalizes amount, date and purpose", () => {
    expect(parseTransactionEdit(form(base))).toEqual({
      operationDate: new Date("2026-09-15"),
      direction: "OUTFLOW",
      amount: "1250.50",
      purpose: "Аренда",
      bankAccountId: "b1",
      cashAccountId: null,
    });
  });

  it("rejects missing or double accounts, bad dates, directions and amounts", () => {
    expect(parseTransactionEdit(form({ ...base, bankAccountId: "" }))).toHaveProperty("error");
    expect(parseTransactionEdit(form({ ...base, cashAccountId: "c1" }))).toHaveProperty("error");
    expect(parseTransactionEdit(form({ ...base, operationDate: "15.09.2026" }))).toHaveProperty("error");
    expect(parseTransactionEdit(form({ ...base, direction: "BOTH" }))).toHaveProperty("error");
    expect(parseTransactionEdit(form({ ...base, amount: "0" }))).toHaveProperty("error");
    expect(parseTransactionEdit(form({ ...base, amount: "10.555" }))).toHaveProperty("error");
    expect(parseTransactionEdit(form({ ...base, amount: "-5" }))).toHaveProperty("error");
  });
});

describe("checkTransactionEdit", () => {
  const leg = (over: Partial<EditableLeg> = {}): EditableLeg => ({
    direction: "OUTFLOW",
    isImported: false,
    allocated: "0",
    bankAccountId: "b1",
    cashAccountId: null,
    ...over,
  });
  const next = (over: Partial<TransactionEditInput> = {}): TransactionEditInput => ({
    operationDate: new Date("2026-09-15"),
    direction: "OUTFLOW",
    amount: "1000.00",
    purpose: null,
    bankAccountId: "b1",
    cashAccountId: null,
    ...over,
  });

  it("allows any change of a manual operation without allocations", () => {
    expect(checkTransactionEdit(leg(), next({ direction: "INFLOW", amount: "5.00", bankAccountId: null, cashAccountId: "c1" }), null)).toBeNull();
  });

  it("keeps imported operations as the bank sent them", () => {
    expect(checkTransactionEdit(leg({ isImported: true }), next(), null)).toMatch(/выписки банка/);
  });

  it("protects allocations: no direction change, no amount below the allocated sum", () => {
    const allocated = leg({ allocated: "600" });
    expect(checkTransactionEdit(allocated, next({ direction: "INFLOW" }), null)).toMatch(/направление/);
    expect(checkTransactionEdit(allocated, next({ amount: "599.99" }), null)).toMatch(/600\.00/);
    expect(checkTransactionEdit(allocated, next({ amount: "600.00" }), null)).toBeNull();
  });

  it("checks the transfer's other leg: its allocations and a different account", () => {
    const pair = leg({ direction: "INFLOW", bankAccountId: "b2" });
    expect(checkTransactionEdit(leg(), next(), pair)).toBeNull();
    expect(checkTransactionEdit(leg(), next({ bankAccountId: "b2" }), pair)).toMatch(/встречной операции/);
    // The pair flips with this leg: this OUTFLOW → INFLOW makes the pair OUTFLOW.
    expect(checkTransactionEdit(leg(), next({ direction: "INFLOW" }), leg({ direction: "INFLOW", bankAccountId: "b2", allocated: "1" }))).toMatch(
      /встречной операции перевода.*направление/,
    );
    expect(checkTransactionEdit(leg(), next({ amount: "10.00" }), leg({ direction: "INFLOW", bankAccountId: "b2", allocated: "20" }))).toMatch(
      /встречной операции перевода/,
    );
  });

  it("checks the other leg of a currency transfer against its own amount", () => {
    const pair = leg({ direction: "INFLOW", bankAccountId: "b2", allocated: "80000" });
    // 1 000 $ sold, 84 000 ₽ received; 80 000 ₽ of the rouble leg are matched with documents.
    expect(checkTransactionEdit(leg(), next({ amount: "1000.00" }), pair, "84000.00")).toBeNull();
    expect(checkTransactionEdit(leg(), next({ amount: "1000.00" }), pair, "79000.00")).toMatch(/встречной операции перевода сопоставлено 80000\.00/);
  });
});

describe("checkTransactionDeletion", () => {
  it("refuses while any leg has active allocations", () => {
    expect(checkTransactionDeletion([{ allocated: "0" }])).toBeNull();
    expect(checkTransactionDeletion([{ allocated: "0" }, { allocated: "0" }])).toBeNull();
    expect(checkTransactionDeletion([{ allocated: "10" }])).toMatch(/сопоставления/);
    expect(checkTransactionDeletion([{ allocated: "0" }, { allocated: "0.01" }])).toMatch(/перевода/);
  });
});

describe("bulk deletion", () => {
  const leg = (id: string, over: Partial<BulkDeletionLeg> = {}) => ({
    id,
    transferGroupId: null,
    batchId: null,
    allocated: "0",
    periodClosed: false,
    label: id,
    ...over,
  });

  it("deletes a transfer whole even if one leg is ticked, and skips matched or closed operations with a reason", () => {
    const legs = [
      leg("a"),
      leg("t1", { transferGroupId: "g" }),
      leg("t2", { transferGroupId: "g" }),
      leg("m", { allocated: "150.00" }),
      leg("c", { periodClosed: true }),
    ];
    const plan = planBulkDeletion(["a", "t1", "m", "c", "unknown"], legs);
    expect(plan.deleteLegs.map((l) => l.id)).toEqual(["a", "t1", "t2"]);
    expect(plan.transfers).toBe(1);
    expect(plan.skipped).toEqual(["m — есть сопоставления с начислениями", "c — период закрыт"]);
    // Both legs ticked — still one transfer.
    expect(planBulkDeletion(["t1", "t2"], legs).deleteLegs.map((l) => l.id)).toEqual(["t1", "t2"]);
  });

  it("counts the deleted operations of each statement import", () => {
    expect([...deletedByBatch([{ batchId: "b1" }, { batchId: "b1" }, { batchId: null }, { batchId: "b2" }])]).toEqual([
      ["b1", 2],
      ["b2", 1],
    ]);
  });
});
