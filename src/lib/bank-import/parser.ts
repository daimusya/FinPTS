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

/**
 * Текстовые выгрузки (CSV/TXT) приходят в UTF-8 (с BOM или без) или — от
 * российских банков, 1С и Excel с русской локалью — в Windows-1251.
 * Байты, не являющиеся корректным UTF-8, считаем Windows-1251.
 */
export function decodeText(buffer: Buffer): string {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buffer.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1251").decode(buffer);
  }
}

function parseTxt(buffer: Buffer): ParsedSheet {
  const text = decodeText(buffer);
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

  // SheetJS reads a CSV buffer as Latin-1, garbling Cyrillic — hand it already-decoded text instead.
  // raw: CSV cells stay text — otherwise 01.09.2026 is guessed as a US date (9 January) and an INN
  // with a leading zero turns into a number. Callers parse ДД.ММ.ГГГГ and «1 500,50» themselves.
  const workbook = lower.endsWith(".csv")
    ? XLSX.read(decodeText(buffer), { type: "string", raw: true })
    : XLSX.read(buffer, { type: "buffer", cellNF: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  convertDateCells(sheet);
  const table = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  const rawHeaders = (table[0] ?? []) as Array<string | number | null>;
  const headers = rawHeaders.map((h, idx) => (h === null || h === undefined || h === "" ? `Колонка ${idx + 1}` : String(h)));
  return { headers, rows: table.slice(1) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Ячейки Excel с форматом даты хранят порядковый номер дня. SheetJS с
 * cellDates переводит его в Date по местному часовому поясу (для Москвы —
 * ещё и с историческим смещением), и после toISOString дата уезжает на
 * день назад. Поэтому переводим номер в ГГГГ-ММ-ДД сами, без часовых поясов.
 */
function convertDateCells(sheet: XLSX.WorkSheet) {
  for (const [address, cell] of Object.entries(sheet)) {
    if (address.startsWith("!")) continue;
    const c = cell as XLSX.CellObject;
    if (c.t !== "n" || typeof c.v !== "number" || !c.z || !XLSX.SSF.is_date(String(c.z))) continue;
    const date = XLSX.SSF.parse_date_code(c.v);
    if (!date) continue;
    sheet[address] = { t: "s", v: `${date.y}-${pad(date.m)}-${pad(date.d)}` };
  }
}
