import * as XLSX from "xlsx";

export interface ExportSheet {
  name: string;
  rows: Array<Array<string | number>>;
}

export function buildWorkbookBuffer(sheets: ExportSheet[]): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name.slice(0, 31));
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
