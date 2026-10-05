import { describe, expect, it } from "vitest";
import { roleDeleteProblem, roleNameProblem, uniqueRoleCode } from "./roles";

describe("roleNameProblem", () => {
  it("requires a name and refuses duplicates regardless of case and spaces", () => {
    expect(roleNameProblem("Бухгалтер", ["Кассир"])).toBeNull();
    expect(roleNameProblem("  ", [])).toBe("Название роли обязательно");
    expect(roleNameProblem("бухгалтер  ", ["Бухгалтер"])).toBe("Роль «бухгалтер» уже есть — выберите другое название");
    expect(roleNameProblem("Главный  бухгалтер", ["главный бухгалтер"])).toMatch(/уже есть/);
    expect(roleNameProblem("x".repeat(101), [])).toMatch(/не длиннее 100/);
  });
});

describe("uniqueRoleCode", () => {
  it("makes a readable code and numbers it when taken", () => {
    expect(uniqueRoleCode("Главный бухгалтер", [])).toBe("главный_бухгалтер");
    expect(uniqueRoleCode("Казначей", ["казначей"])).toBe("казначей_2");
    expect(uniqueRoleCode("Казначей!", ["казначей", "казначей_2"])).toBe("казначей_3");
    expect(uniqueRoleCode("Учёт", [])).toBe("учет");
    expect(uniqueRoleCode("!!!", [])).toBe("role");
  });
});

describe("roleDeleteProblem", () => {
  it("only unused custom roles can be deleted", () => {
    expect(roleDeleteProblem({ isSystem: false, userCount: 0, routeNames: [] })).toBeNull();
    expect(roleDeleteProblem({ isSystem: true, userCount: 0, routeNames: [] })).toMatch(/Системную/);
    expect(roleDeleteProblem({ isSystem: false, userCount: 2, routeNames: [] })).toMatch(/пользователям \(2\)/);
    expect(roleDeleteProblem({ isSystem: false, userCount: 0, routeNames: ["Крупные платежи"] })).toMatch(/Крупные платежи/);
  });
});
