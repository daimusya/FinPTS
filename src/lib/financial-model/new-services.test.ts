import { describe, expect, it } from "vitest";
import { parseNewServiceForm } from "./new-services";

const valid = { name: "Аудит СОУТ", launch: "2026-11", avgCheck: "45 000", salesPerMonth: "4", rampUpMonths: "3", variableCostPct: "" };

describe("parseNewServiceForm", () => {
  it("parses a filled form, accepting spaces and an empty variable-cost percent", () => {
    const result = parseNewServiceForm(valid, null);
    if ("error" in result) throw new Error(result.error);
    expect(result.data).toMatchObject({ name: "Аудит СОУТ", launchYear: 2026, launchMonth: 11, rampUpMonths: 3, variableCostPct: null });
    expect(result.data.avgCheck.toNumber()).toBe(45000);
  });

  it("takes the name from the selected product when the name field is empty", () => {
    const result = parseNewServiceForm({ ...valid, name: " ", productServiceId: "p1" }, "Обучение по охране труда");
    expect("data" in result && result.data).toMatchObject({ name: "Обучение по охране труда", productServiceId: "p1" });
  });

  it("rejects missing or out-of-range values with a message", () => {
    expect(parseNewServiceForm({ ...valid, name: "" }, null)).toEqual({ error: "Укажите название услуги или выберите её из справочника" });
    expect(parseNewServiceForm({ ...valid, launch: "" }, null)).toHaveProperty("error");
    expect(parseNewServiceForm({ ...valid, avgCheck: "0" }, null)).toHaveProperty("error");
    expect(parseNewServiceForm({ ...valid, salesPerMonth: "-1" }, null)).toHaveProperty("error");
    expect(parseNewServiceForm({ ...valid, rampUpMonths: "1.5" }, null)).toHaveProperty("error");
    expect(parseNewServiceForm({ ...valid, variableCostPct: "120" }, null)).toHaveProperty("error");
  });
});
