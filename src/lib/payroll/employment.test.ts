import { describe, expect, it } from "vitest";
import { allocationProblem, salaryChangeProblem, terminationProblem, transferProblem } from "./employment";

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

describe("allocationProblem", () => {
  const employee = { status: "ACTIVE", organizationId: "org" };
  const project = { id: "p1", organizationId: "org", isArchived: false };
  it("accepts a share that fits", () => {
    expect(allocationProblem({ employee, project, sharePctRaw: "40", active: [{ projectId: "p2", sharePct: 60 }] })).toBeNull();
    expect(allocationProblem({ employee, project, sharePctRaw: "12,5", active: [] })).toBeNull();
  });
  it("refuses bad shares, duplicates, overbooking, foreign projects and dismissed employees", () => {
    expect(allocationProblem({ employee, project, sharePctRaw: "abc", active: [] })).toMatch(/больше 0 и не больше 100/);
    expect(allocationProblem({ employee, project, sharePctRaw: "0", active: [] })).toMatch(/больше 0/);
    expect(allocationProblem({ employee, project, sharePctRaw: "101", active: [] })).toMatch(/не больше 100/);
    expect(allocationProblem({ employee, project, sharePctRaw: "50", active: [{ projectId: "p1", sharePct: 20 }] })).toMatch(/уже распределён/);
    expect(allocationProblem({ employee, project, sharePctRaw: "50", active: [{ projectId: "p2", sharePct: 60 }] })).toBe("Вместе с действующими долями получится 110% — больше 100%");
    expect(allocationProblem({ employee, project: { ...project, organizationId: "other" }, sharePctRaw: "10", active: [] })).toMatch(/другой организации/);
    expect(allocationProblem({ employee: { ...employee, status: "TERMINATED" }, project, sharePctRaw: "10", active: [] })).toMatch(/Уволенного/);
    expect(allocationProblem({ employee, project: null, sharePctRaw: "10", active: [] })).toBe("Выберите проект");
  });
});
