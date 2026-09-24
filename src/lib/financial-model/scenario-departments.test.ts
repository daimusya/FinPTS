import { describe, expect, it } from "vitest";
import { pickScenarioDepartmentIds } from "./scenario-departments";

describe("pickScenarioDepartmentIds", () => {
  it("shows the default departments until the scenario has its own list", () => {
    expect(pickScenarioDepartmentIds({ memberIds: [], defaultIds: ["training", "safety"], idsWithValues: [] })).toEqual([
      "training",
      "safety",
    ]);
  });

  it("uses the scenario's own list once it exists, ignoring the defaults", () => {
    expect(pickScenarioDepartmentIds({ memberIds: ["safety", "sales"], defaultIds: ["training", "safety"], idsWithValues: [] })).toEqual([
      "safety",
      "sales",
    ]);
  });

  it("always shows departments that already have values, without duplicates", () => {
    expect(
      pickScenarioDepartmentIds({ memberIds: [], defaultIds: ["training", "safety"], idsWithValues: ["safety", "legacy"] }),
    ).toEqual(["training", "safety", "legacy"]);
  });
});
