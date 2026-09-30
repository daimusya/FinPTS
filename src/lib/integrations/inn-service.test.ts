import { describe, expect, it } from "vitest";
import { changedRegistryFields, needsRegistryData, organizationDataFromRegistry } from "./inn-service";
import { ORGANIZATION_REGISTRY_LABELS } from "./inn-labels";
import type { PartyRequisites } from "./inn";

const requisites: PartyRequisites = {
  inn: "500100732259",
  fullName: "Индивидуальный предприниматель Иванов Иван Иванович",
  shortName: "ИП Иванов Иван Иванович",
  kpp: null,
  ogrn: "304500116000157",
  legalAddress: "г Москва",
  director: null,
  status: "Действует",
  type: "SOLE_PROPRIETOR",
  registrationDate: new Date("2004-03-15T00:00:00Z"),
  liquidationDate: null,
};

describe("needsRegistryData", () => {
  const base = { inn: "7707083893", dataSource: null, kpp: null, ogrn: null, legalAddress: null };
  it("picks counterparties created by 1C or with a bare name and INN", () => {
    expect(needsRegistryData({ ...base, dataSource: "1C", kpp: "773601001" })).toBe(true);
    expect(needsRegistryData(base)).toBe(true);
  });
  it("leaves registry data, hand-entered requisites and counterparties without INN alone", () => {
    expect(needsRegistryData({ ...base, dataSource: "DADATA" })).toBe(false);
    expect(needsRegistryData({ ...base, kpp: "773601001" })).toBe(false);
    expect(needsRegistryData({ ...base, inn: null })).toBe(false);
  });
});

describe("organization from the registry", () => {
  it("takes the type and dates of registration and closure, not the tax system", () => {
    const data = organizationDataFromRegistry(requisites);
    expect(data).toMatchObject({ name: requisites.fullName, type: "SOLE_PROPRIETOR", registrationDate: requisites.registrationDate, closureDate: null });
    expect(data).not.toHaveProperty("taxSystem");
  });

  it("names only the fields that actually change", () => {
    const before = {
      name: requisites.fullName,
      shortName: "ИП Иванов",
      type: "SOLE_PROPRIETOR",
      kpp: null,
      ogrn: "304500116000157",
      legalAddress: "г Москва",
      registrationDate: new Date("2004-03-15T00:00:00Z"),
      closureDate: null,
    };
    expect(changedRegistryFields(before, organizationDataFromRegistry(requisites), ORGANIZATION_REGISTRY_LABELS)).toEqual(["краткое наименование"]);
  });
});
