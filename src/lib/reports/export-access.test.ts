import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions";
import { canExportReport, exportViewPermission } from "./export-access";

describe("canExportReport", () => {
  const exporter = [PERMISSIONS.REPORTS_EXPORT, PERMISSIONS.REPORTS_VIEW];
  it("needs both export and the report's own view right", () => {
    expect(canExportReport(exporter, "pnl")).toBe(true);
    expect(canExportReport(exporter, "payroll-summary")).toBe(false);
    expect(canExportReport([...exporter, PERMISSIONS.PAYROLL_VIEW], "payroll-summary")).toBe(true);
    expect(canExportReport(exporter, "scenario-forecast")).toBe(false);
    expect(canExportReport([PERMISSIONS.REPORTS_VIEW], "pnl")).toBe(false);
    expect(canExportReport([PERMISSIONS.PAYROLL_VIEW, PERMISSIONS.REPORTS_EXPORT], "debts")).toBe(false);
  });
  it("full administrator exports everything; unknown types nothing", () => {
    expect(canExportReport([PERMISSIONS.ADMIN_FULL], "payroll-summary")).toBe(true);
    expect(canExportReport([PERMISSIONS.ADMIN_FULL], "secrets")).toBe(false);
    expect(exportViewPermission("toString")).toBeNull();
    expect(exportViewPermission(undefined)).toBeNull();
  });
});
