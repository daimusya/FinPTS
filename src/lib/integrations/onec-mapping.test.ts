import { describe, expect, it } from "vitest";
import { extractOnecRow, type OnecColumnMapping } from "./onec-mapping";

describe("extractOnecRow", () => {
  it("extracts all mapped fields from a row", () => {
    const mapping: OnecColumnMapping = {
      0: "externalId",
      1: "organizationInn",
      2: "counterpartyInn",
      3: "documentType",
      4: "direction",
      5: "number",
      6: "date",
      7: "amount",
      8: "pnlArticleCode",
    };
    const row = ["1C-GUID-001", "ИНН 7700000000", "7701234567", "sale", "income", "РЕАЛ-1", "15.09.2026", "10 000,50", "REV"];
    const result = extractOnecRow(row, mapping);

    expect(result.externalId).toBe("1C-GUID-001");
    expect(result.organizationInn).toBe("7700000000");
    expect(result.counterpartyInn).toBe("7701234567");
    expect(result.documentType).toBe("SALE");
    expect(result.direction).toBe("INCOME");
    expect(result.number).toBe("РЕАЛ-1");
    expect(result.date?.getUTCFullYear()).toBe(2026);
    expect(result.amount).toBe(10000.5);
    expect(result.pnlArticleCode).toBe("REV");
  });

  it("leaves unmapped fields null", () => {
    const result = extractOnecRow(["x"], { 0: "number" });
    expect(result.externalId).toBeNull();
    expect(result.amount).toBeNull();
    expect(result.number).toBe("x");
  });
});
