import { NextRequest } from "next/server";
import * as XLSX from "xlsx";
import { requireSession } from "@/lib/session";
import { getAccessScope } from "@/lib/access-scope";
import { canExportReport } from "@/lib/reports/export-access";
import { parseMonthParam } from "@/lib/intermediaries/load";
import { loadIntermediaryReports, parseCommissionVersion, type IntermediaryReport } from "@/lib/intermediaries/report";

const NUMBER_FORMAT = "#,##0 ;[Red](#,##0)";
const day = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");

/**
 * Лист в раскладке шаблона «ХАРЛАМОВА 0926.xlsx»: заголовок в B2, статья в
 * B3, шапка таблицы в строках 5–6, операции с 7-й строки, затем «Итого» и
 * комиссия формулой от итога (ставка менялась в месяце — строка на каждую ставку).
 */
function reportSheet(report: IntermediaryReport): XLSX.WorkSheet {
  const rows: Array<Array<string | number | null>> = [
    [],
    [null, report.title],
    [null, report.article],
    [],
    [null, "Дата", "Контрагент", "Назначение платежа", "Поступления"],
    [],
    ...report.lines.map((l) => [null, day(l.date), l.counterparty, l.purpose, l.amount.toNumber()]),
    [null, "Итого", null, null, report.total.toNumber()],
    ...report.commissionLines.map((c) => [null, c.label, null, null, c.amount ? c.amount.toNumber() : null]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const first = 7;
  const totalRow = first + report.lines.length;
  for (let r = first; r <= totalRow + report.commissionLines.length; r++) {
    const cell = sheet[`E${r}`];
    if (cell && cell.t === "n") cell.z = NUMBER_FORMAT;
  }
  if (report.lines.length) sheet[`E${totalRow}`].f = `SUM(E${first}:E${totalRow - 1})`;
  if (report.commission && report.commissionPct && report.commissionLines.length === 1) {
    sheet[`E${totalRow + 1}`].f = `ROUND(E${totalRow}*${report.commissionPct.toString()}/100,2)`;
  }
  sheet["!merges"] = [
    { s: { r: 1, c: 1 }, e: { r: 1, c: 4 } },
    { s: { r: 2, c: 1 }, e: { r: 2, c: 4 } },
    { s: { r: 4, c: 1 }, e: { r: 5, c: 1 } },
    { s: { r: 4, c: 2 }, e: { r: 5, c: 2 } },
    { s: { r: 4, c: 3 }, e: { r: 5, c: 3 } },
    { s: { r: 4, c: 4 }, e: { r: 5, c: 4 } },
    { s: { r: totalRow - 1, c: 1 }, e: { r: totalRow - 1, c: 3 } },
    ...report.commissionLines.map((_, i) => ({ s: { r: totalRow + i, c: 1 }, e: { r: totalRow + i, c: 3 } })),
  ];
  sheet["!cols"] = [{ wch: 1 }, { wch: 11 }, { wch: 30 }, { wch: 55 }, { wch: 18 }];
  return sheet;
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

  const workbook = XLSX.utils.book_new();
  const used = new Set<string>();
  for (const report of reports) XLSX.utils.book_append_sheet(workbook, reportSheet(report), sheetName(report.name, used));
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

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
