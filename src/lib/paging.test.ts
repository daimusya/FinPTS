import { describe, expect, it } from "vitest";
import { pageHref, pageWindow } from "./paging";

describe("pageWindow", () => {
  it("computes the slice and caption", () => {
    expect(pageWindow(1250, "2", 200)).toMatchObject({ page: 2, pages: 7, skip: 200, take: 200 });
    expect(pageWindow(1250, "2", 200).caption.replace(/\s/g, " ")).toBe("Записи 201–400 из 1 250");
    expect(pageWindow(0, undefined, 200)).toMatchObject({ page: 1, pages: 1, skip: 0, caption: "Записей нет" });
  });
  it("clamps nonsense page numbers", () => {
    expect(pageWindow(50, "99", 20).page).toBe(3);
    expect(pageWindow(50, "-1", 20).page).toBe(1);
    expect(pageWindow(50, "abc", 20).page).toBe(1);
    expect(pageWindow(50, "2.7", 20).page).toBe(2);
  });
});

describe("pageHref", () => {
  it("keeps filters, drops empty ones and page 1", () => {
    expect(pageHref("/accruals", { status: "POSTED", from: "", page: "3" }, 2)).toBe("/accruals?status=POSTED&page=2");
    expect(pageHref("/accruals", { status: "POSTED" }, 1)).toBe("/accruals?status=POSTED");
    expect(pageHref("/accruals", {}, 1)).toBe("/accruals");
  });
});
