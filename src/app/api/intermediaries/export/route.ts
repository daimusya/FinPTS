import { NextRequest } from "next/server";
import { Workbook, type Row } from "exceljs";
import { requireSession } from "@/lib/session";
import { getAccessScope } from "@/lib/access-scope";
import { canExportReport } from "@/lib/reports/export-access";
import { parseMonthParam } from "@/lib/intermediaries/load";
import { commissionReportColumns, commissionReportVersionNotes, loadIntermediaryReports, parseCommissionVersion, type IntermediaryReport } from "@/lib/intermediaries/report";

const day = (date: Date) => date.toISOString().slice(0, 10).split("-").reverse().join(".");
const gridBorder = { style: "thin", color: { argb: "FF000000" } } as const;

function wrappedLines(text: string, width: number) {
  return text.split("\n").reduce((count, line) => count + Math.max(1, Math.ceil(line.length / width)), 0);
}

function formatTableRow(row: Row, shaded: boolean) {
  row.height = 16;
  for (let column = 1; column <= 4; column++) {
    const cell = row.getCell(column);
    cell.font = { name: "Arial", size: 9, bold: shaded, color: { argb: "FF000000" } };
    cell.border = { top: gridBorder, bottom: gridBorder, left: gridBorder, right: gridBorder };
    cell.alignment = { vertical: "top", horizontal: column === 1 ? "center" : column === 4 ? "right" : "left", wrapText: true };
    if (shaded) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
  }
}

function numberFormat(value: number | string) {
  return typeof value === "number" && !Number.isInteger(value) ? "#,##0.0#" : "#,##0";
}

function addReportSheet(workbook: Workbook, name: string, report: IntermediaryReport) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const widths = [15, 26, 38, 18];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });

  const addHeading = (text: string, size = 10, bold = false) => {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, 4);
    row.getCell(1).font = { name: "Arial", size, bold };
    row.getCell(1).alignment = { wrapText: true, vertical: "top" };
    row.height = Math.min(409, wrappedLines(text, 90) * (size + 5));
  };

  addHeading(report.title, 13, true);
  addHeading(report.article);
  for (const note of commissionReportVersionNotes(report)) addHeading(note);
  sheet.addRow([]).height = 7;
  const header = sheet.addRow([...commissionReportColumns]);
  formatTableRow(header, true);
  header.eachCell((cell) => { cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });

  const first = header.number + 1;
  for (const line of report.lines) {
    const amount = line.amount.toNumber();
    const row = sheet.addRow([day(line.date), line.counterparty, line.purpose, amount]);
    formatTableRow(row, false);
    row.height = Math.min(409, 12 * Math.max(wrappedLines(line.counterparty, 24), wrappedLines(line.purpose ?? "", 35)) + 4);
    row.getCell(4).numFmt = numberFormat(amount);
  }
  const addTotal = (label: string, value: number | string) => {
    const row = sheet.addRow([label, null, null, value]);
    sheet.mergeCells(row.number, 1, row.number, 3);
    formatTableRow(row, true);
    row.getCell(1).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    row.height = Math.min(409, wrappedLines(label, 76) * 12 + 4);
    row.getCell(4).numFmt = numberFormat(value);
    return row;
  };
  const total = addTotal("Итого", report.total.toNumber());
  if (report.lines.length) {
    total.getCell(4).value = { formula: `SUM(D${first}:D${total.number - 1})`, result: report.total.toNumber() };
  }
  for (const line of report.commissionLines) {
    const row = addTotal(line.label, line.amount?.toNumber() ?? "—");
    if (line.amount !== null && report.commissionPct !== null && report.commissionLines.length === 1) {
      row.getCell(4).value = {
        formula: `ROUND(D${total.number}*${report.commissionPct.toString()}/100,2)`,
        result: line.amount.toNumber(),
      };
    }
  }
  sheet.pageSetup.printTitlesRow = `${header.number}:${header.number}`;
}

/** Имя листа Excel: до 31 символа, без []:*?/\ и неповторяющееся. */
function sheetName(name: string, used: Set<string>): string {
  const base = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 28) || "Посредник";
  let candidate = base;
  for (let i = 2; used.has(candidate); i++) candidate = `${base} ${i}`;
  used.add(candidate);
  return candidate;
}

export async function GET(request: NextRequest) {
  const session = await requireSession();
  if (!canExportReport(session.permissions, "intermediaries")) {
    return new Response("Недостаточно прав для выгрузки", { status: 403 });
  }
  const ym = parseMonthParam(request.nextUrl.searchParams.get("month"));
  if (!ym) return new Response("Укажите месяц", { status: 400 });
  const id = request.nextUrl.searchParams.get("id") || "all";
  const versionParam = request.nextUrl.searchParams.get("version");
  const version = versionParam === null ? undefined : parseCommissionVersion(versionParam);
  if (version === null || (version !== undefined && id === "all")) return new Response("Некорректная версия отчёта", { status: 400 });
  const reports = await loadIntermediaryReports(await getAccessScope(session), ym, id, version);
  if (reports.length === 0) return new Response("За этот месяц поступлений через посредников нет", { status: 404 });

  const workbook = new Workbook();
  const used = new Set<string>();
  for (const report of reports) addReportSheet(workbook, sheetName(report.name, used), report);
  const buffer = await workbook.xlsx.writeBuffer();

  // Как у шаблона: «ХАРЛАМОВА 0926.xlsx» — фамилия и ММГГ.
  const period = `${String(ym.month).padStart(2, "0")}${String(ym.year).slice(2)}`;
  const versionSuffix = version !== undefined ? ` (версия ${version})` : "";
  const fileName = `${id === "all" ? "ПОСРЕДНИКИ" : reports[0].name.toUpperCase()} ${period}${versionSuffix}.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // Заголовок — только ASCII; русское имя файла передаётся в filename* (RFC 5987).
      "Content-Disposition": `attachment; filename="intermediaries_${period}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
