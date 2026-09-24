import { describe, expect, it } from "vitest";
import { DICTIONARY_REGISTRY } from "./registry";
import { dictionaryColumns, emptyFieldValue } from "./columns";

describe("emptyFieldValue", () => {
  const nullable = { nullable: true, hasDbDefault: false };
  const notNull = { nullable: false, hasDbDefault: true };

  it("clears a nullable field on edit and leaves it to the DB default on create", () => {
    expect(emptyFieldValue({}, "update", nullable)).toBeNull();
    expect(emptyFieldValue({}, "create", nullable)).toBeUndefined();
  });

  it("keeps the old value of a NOT NULL column on edit and prefers the field's own default", () => {
    expect(emptyFieldValue({}, "update", notNull)).toBeUndefined();
    expect(emptyFieldValue({ defaultValue: "active" }, "update", notNull)).toBe("active");
  });
});

describe("dictionary registry vs database schema", () => {
  it("finds the model of every dictionary", () => {
    for (const config of Object.values(DICTIONARY_REGISTRY)) {
      expect(() => dictionaryColumns(config)).not.toThrow();
    }
  });

  it("only makes a field optional in a form when the column is nullable or has a default", () => {
    const problems: string[] = [];
    for (const config of Object.values(DICTIONARY_REGISTRY)) {
      const columns = dictionaryColumns(config);
      for (const field of config.fields) {
        if (field.required || field.type === "checkbox") continue;
        const column = columns.get(field.name);
        if (!column) problems.push(`${config.slug}.${field.name}: нет колонки`);
        else if (!column.nullable && !column.hasDbDefault && field.defaultValue === undefined) {
          problems.push(`${config.slug}.${field.name}: NOT NULL без значения по умолчанию`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("clears an organization's INN and a project's code on edit", () => {
    const orgColumns = dictionaryColumns(DICTIONARY_REGISTRY.organizations);
    const projectColumns = dictionaryColumns(DICTIONARY_REGISTRY.projects);
    expect(emptyFieldValue({}, "update", orgColumns.get("inn"))).toBeNull();
    expect(emptyFieldValue({}, "update", projectColumns.get("code"))).toBeNull();
    expect(emptyFieldValue({ defaultValue: "active" }, "update", projectColumns.get("status"))).toBe("active");
  });
});
