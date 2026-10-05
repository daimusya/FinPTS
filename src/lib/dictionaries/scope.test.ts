import { describe, expect, it } from "vitest";
import { UNRESTRICTED_SCOPE } from "@/lib/access-scope";
import {
  NEW_ORGANIZATION_NOT_ALLOWED,
  ORGANIZATION_RECORD_NOT_ALLOWED,
  dictionaryCreateProblem,
  dictionaryRecordAllowed,
  dictionaryScopeWhere,
  organizationBinding,
} from "./scope";

const accounts = { slug: "bank-accounts", fields: [{ name: "organizationId", label: "Организация", type: "select" as const, required: true }] };
const departments = { slug: "departments", fields: [{ name: "organizationId", label: "Организация", type: "select" as const }] };
const organizations = { slug: "organizations", fields: [{ name: "name", label: "Название", type: "text" as const }] };
const articles = { slug: "cash-flow-articles", fields: [{ name: "name", label: "Название", type: "text" as const }] };
const scope = { organizationIds: ["org-a"], departmentIds: null, projectIds: null };

describe("organizationBinding", () => {
  it("binds dictionaries with an organization field and the organizations dictionary itself", () => {
    expect(organizationBinding(accounts)).toEqual({ field: "organizationId", nullable: false });
    expect(organizationBinding(departments)).toEqual({ field: "organizationId", nullable: true });
    expect(organizationBinding(organizations)).toEqual({ field: "id", nullable: false });
    expect(organizationBinding(articles)).toBeNull();
  });
});

describe("dictionaryScopeWhere", () => {
  it("limits bound dictionaries to the user's organizations, shared departments stay visible", () => {
    expect(dictionaryScopeWhere(accounts, scope)).toEqual({ organizationId: { in: ["org-a"] } });
    expect(dictionaryScopeWhere(organizations, scope)).toEqual({ id: { in: ["org-a"] } });
    expect(dictionaryScopeWhere(departments, scope)).toEqual({ OR: [{ organizationId: { in: ["org-a"] } }, { organizationId: null }] });
  });

  it("no restriction for unrestricted users and shared dictionaries", () => {
    expect(dictionaryScopeWhere(accounts, UNRESTRICTED_SCOPE)).toEqual({});
    expect(dictionaryScopeWhere(articles, scope)).toEqual({});
  });
});

describe("dictionaryRecordAllowed", () => {
  it("checks the organization of a record or of the data being saved", () => {
    expect(dictionaryRecordAllowed(accounts, scope, { organizationId: "org-a" })).toBe(true);
    expect(dictionaryRecordAllowed(accounts, scope, { organizationId: "org-b" })).toBe(false);
    expect(dictionaryRecordAllowed(organizations, scope, { id: "org-b" })).toBe(false);
    expect(dictionaryRecordAllowed(departments, scope, { organizationId: null })).toBe(true);
    expect(dictionaryRecordAllowed(accounts, scope, { organizationId: "" })).toBe(false);
    expect(dictionaryRecordAllowed(accounts, UNRESTRICTED_SCOPE, { organizationId: "org-b" })).toBe(true);
    expect(dictionaryRecordAllowed(articles, scope, { name: "x" })).toBe(true);
  });
});

describe("dictionaryCreateProblem", () => {
  it("restricted users create records only in their organizations and no new organizations", () => {
    expect(dictionaryCreateProblem(accounts, scope, { organizationId: "org-a" })).toBeNull();
    expect(dictionaryCreateProblem(accounts, scope, { organizationId: "org-b" })).toBe(ORGANIZATION_RECORD_NOT_ALLOWED);
    expect(dictionaryCreateProblem(organizations, scope, { name: "Новая" })).toBe(NEW_ORGANIZATION_NOT_ALLOWED);
    expect(dictionaryCreateProblem(organizations, UNRESTRICTED_SCOPE, { name: "Новая" })).toBeNull();
    expect(dictionaryCreateProblem(articles, scope, { name: "x" })).toBeNull();
  });
});
