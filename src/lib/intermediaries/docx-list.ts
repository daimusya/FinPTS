import * as XLSX from "xlsx";

export interface IntermediaryListEntry {
  /** Посредник, как в первой колонке («Харламова»). */
  name: string;
  /** Комиссия, % — из первой колонки («Харламова 20%»); null, если не указана. */
  commissionPct: number | null;
  /** Организации посредника — по одной на строку второй колонки. */
  clients: string[];
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Строки ячейки таблицы Word: абзацы и разрывы строк. */
function cellLines(cellXml: string): string[] {
  let text = "";
  for (const [token, run] of cellXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:br\b[^>]*\/>|<\/w:p>|<w:tab\b[^>]*\/>/g)) {
    if (run !== undefined) text += run;
    else text += token.startsWith("<w:tab") ? " " : "\n";
  }
  return decodeXml(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").replace(/[,;]+$/, "").trim())
    .filter(Boolean);
}

/**
 * Список посредников из документа Word: таблица «Посредник | Список
 * организаций», в первой колонке имя и процент («Харламова 20%»), во второй —
 * организации по одной на строку. Строка заголовка пропускается.
 */
export function parseIntermediaryListDocx(buffer: Buffer): IntermediaryListEntry[] {
  const zip = XLSX.CFB.read(buffer, { type: "buffer" });
  const index = zip.FullPaths.findIndex((path: string) => path.endsWith("/word/document.xml"));
  if (index < 0) throw new Error("Это не документ Word (.docx)");
  const xml = Buffer.from(zip.FileIndex[index].content as Uint8Array).toString("utf8");

  const entries: IntermediaryListEntry[] = [];
  for (const row of xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? []) {
    const cells = (row.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []).map(cellLines);
    if (cells.length < 2) continue;
    const head = cells[0].join(" ");
    if (!head || /посредник/i.test(head)) continue;
    const pct = head.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const name = head.replace(/(\d+(?:[.,]\d+)?)\s*%/, "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    entries.push({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      commissionPct: pct ? Number(pct[1].replace(",", ".")) : null,
      clients: [...new Set(cells.slice(1).flat())],
    });
  }
  return entries;
}
