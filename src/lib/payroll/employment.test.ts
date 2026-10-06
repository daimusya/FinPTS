import { describe, expect, it } from "vitest";
import { salaryChangeProblem, terminationProblem, transferProblem } from "./employment";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const working = { status: "ACTIVE", hireDate: d("2026-03-02"), terminationDate: null };
const dismissed = { status: "TERMINATED", hireDate: d("2026-03-02"), terminationDate: d("2026-09-04") };

describe("employment events", () => {
  it("termination: once, not before hiring", () => {
    expect(terminationProblem(working, d("2026-10-01"))).toBeNull();
    expect(terminationProblem(working, d("2026-02-01"))).toBe("Дата увольнения раньше даты приёма (02.03.2026)");
    expect(terminationProblem(dismissed, d("2026-10-01"))).toBe("Сотрудник уже уволен 04.09.2026");
  });
  it("transfer: working employees only, not before hiring", () => {
    expect(transferProblem(working, d("2026-06-01"))).toBeNull();
    expect(transferProblem(working, d("2026-01-01"))).toMatch(/раньше даты приёма/);
    expect(transferProblem(dismissed, d("2026-06-01"))).toBe("Уволенного сотрудника перевести нельзя");
  });
  it("salary change: between hiring and dismissal", () => {
    expect(salaryChangeProblem(working, d("2026-04-01"))).toBeNull();
    expect(salaryChangeProblem(working, d("2026-01-01"))).toMatch(/раньше приёма/);
    expect(salaryChangeProblem(dismissed, d("2026-10-01"))).toMatch(/после увольнения/);
  });
});
