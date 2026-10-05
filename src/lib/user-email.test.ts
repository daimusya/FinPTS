import { describe, expect, it } from "vitest";
import { normalizeUserEmail } from "./user-email";

describe("normalizeUserEmail", () => {
  it("trims and lowercases a valid address", () => {
    expect(normalizeUserEmail("  Anna.Petrova@Example.RU ")).toEqual({ email: "anna.petrova@example.ru" });
  });
  it("explains invalid input", () => {
    expect(normalizeUserEmail("")).toEqual({ error: "Укажите email" });
    expect(normalizeUserEmail("anna@example")).toEqual({ error: "«anna@example» не похоже на адрес почты" });
    expect(normalizeUserEmail("anna petrova@example.ru")).toMatchObject({ error: expect.stringMatching(/не похоже/) });
    expect(normalizeUserEmail(`${"a".repeat(250)}@x.ru`)).toMatchObject({ error: expect.stringMatching(/не похоже/) });
  });
});
