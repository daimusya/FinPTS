import { describe, expect, it } from "vitest";
import { approvalSeparationProblem } from "./separation";

const base = { isAdmin: false, userId: "u2", authorId: "u1", round: 1, currentStep: 2, decisions: [] };

describe("approvalSeparationProblem", () => {
  it("another person approves", () => {
    expect(approvalSeparationProblem(base)).toBeNull();
  });
  it("the author cannot approve their own request", () => {
    expect(approvalSeparationProblem({ ...base, userId: "u1" })).toBe("Свою заявку согласовать нельзя — её согласует другой сотрудник");
  });
  it("one person cannot approve two steps of the same round", () => {
    const decisions = [{ approverId: "u2", decision: "approved", stepOrder: 1, round: 1 }];
    expect(approvalSeparationProblem({ ...base, decisions })).toBe("Вы уже согласовали шаг 1 этой заявки — следующий шаг согласует другой сотрудник");
    // An earlier round (before rework) does not count; neither does a return.
    expect(approvalSeparationProblem({ ...base, decisions: [{ ...decisions[0], round: 0 }], round: 1 })).toBeNull();
    expect(approvalSeparationProblem({ ...base, decisions: [{ ...decisions[0], decision: "returned" }] })).toBeNull();
  });
  it("the full administrator may decide anyway", () => {
    expect(approvalSeparationProblem({ ...base, isAdmin: true, userId: "u1" })).toBeNull();
  });
});
