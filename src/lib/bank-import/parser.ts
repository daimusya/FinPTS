import * as XLSX from "xlsx";

export interface ParsedSheet {
  headers: string[];
  rows: Array<Array<string | number | null>>;
}

function detectDelimiter(sample: string): string {
  const candidates = ["\t", ";", ","];
  let best = ",";
  let bestCount = -1;
  for (const delim of candidates) {
    const count = (sample.match(new RegExp(`\\${delim}`, "g")) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = delim;
    }
  }
  return best;
}

function parseTxt(buffer: Buffer): ParsedSheet {
  const text = buffer.toString("utf-8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = detectDelimiter(lines[0]);
  const table = lines.map((line) => line.split(delimiter).map((cell) => cell.trim()));
  const [headers, ...rows] = table;
  return { headers, rows };
}

export function parseSpreadsheet(buffer: Buffer, fileName: string): ParsedSheet {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".txt")) {
    return parseTxt(buffer);
  }

  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  const table = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  const rawHeaders = (table[0] ?? []) as Array<string | number | null>;
  const headers = rawHeaders.map((h, idx) => (h === null || h === undefined || h === "" ? `Колонка ${idx + 1}` : String(h)));
  const rawRows = table.slice(1) as Array<Array<string | number | Date | null>>;
  const rows = rawRows.map((row) =>
    row.map((cell) => (cell instanceof Date ? cell.toISOString().slice(0, 10) : cell)),
  );
  return { headers, rows };
}
