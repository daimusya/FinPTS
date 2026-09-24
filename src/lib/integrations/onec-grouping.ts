import { extractOnecRow, type ExtractedOnecRow, type OnecColumnMapping } from "./onec-mapping";

export const ONEC_DOCUMENT_TYPES = new Set(["INVOICE", "ACT", "UPD", "WAYBILL", "SALE", "RECEIPT", "RETURN", "CORRECTION", "MANUAL"]);
export const ONEC_DIRECTIONS = new Set(["INCOME", "EXPENSE"]);

/** Поля шапки документа — одинаковые во всех его строках. */
const HEADER_FIELDS = [
  "organizationInn",
  "counterpartyInn",
  "counterpartyName",
  "documentType",
  "direction",
  "number",
  "date",
  "dueDate",
  "comment",
] as const;
type HeaderField = (typeof HEADER_FIELDS)[number];

const HEADER_LABELS: Record<HeaderField, string> = {
  organizationInn: "ИНН организации",
  counterpartyInn: "ИНН контрагента",
  counterpartyName: "наименование контрагента",
  documentType: "тип документа",
  direction: "направление",
  number: "номер",
  date: "дата",
  dueDate: "срок оплаты",
  comment: "комментарий",
};

export type OnecHeader = { [K in HeaderField]: ExtractedOnecRow[K] };

export interface OnecLine {
  rowNumber: number;
  amount: number;
  vatAmount: number | null;
  pnlArticleCode: string;
  description: string | null;
  departmentName: string | null;
  costCenterName: string | null;
  projectName: string | null;
  productServiceName: string | null;
}

export interface OnecDocumentGroup {
  externalId: string;
  rowNumbers: number[];
  header: OnecHeader;
  lines: OnecLine[];
}

export interface OnecGroupError {
  externalId: string | null;
  rowNumbers: number[];
  message: string;
}

/** «строка 5» или «строки 2–4» / «строки 2, 5, 9» — для сообщений об ошибках. */
export function describeRows(rowNumbers: number[]): string {
  if (rowNumbers.length === 1) return `строка ${rowNumbers[0]}`;
  const contiguous = rowNumbers.every((n, i) => i === 0 || n === rowNumbers[i - 1] + 1);
  return contiguous
    ? `строки ${rowNumbers[0]}–${rowNumbers[rowNumbers.length - 1]}`
    : `строки ${rowNumbers.join(", ")}`;
}

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;

const isEmptyRow = (row: Array<string | number | null>) => row.every((cell) => cell === null || String(cell).trim() === "");

/**
 * Собирает строки файла 1С в документы: строки с одинаковым внешним ID —
 * один документ, каждая строка — строка начисления (сумма, НДС, статья
 * ОПиУ и аналитика). Поля шапки можно заполнить только в одной строке
 * документа (как часто выгружает 1С); если в двух строках они разные —
 * документ с ошибкой, с номерами строк и полем. Ошибка в любой строке
 * отклоняет документ целиком — чтобы не загрузить его без части строк.
 * Номера строк — как в файле (первая строка данных — 2).
 */
export function groupOnecRows(
  rows: Array<Array<string | number | null>>,
  mapping: OnecColumnMapping,
): { documents: OnecDocumentGroup[]; errors: OnecGroupError[] } {
  const errors: OnecGroupError[] = [];
  const groups = new Map<string, Array<{ rowNumber: number; data: ExtractedOnecRow }>>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (isEmptyRow(row)) return;
    const data = extractOnecRow(row, mapping);
    if (!data.externalId) {
      errors.push({ externalId: null, rowNumbers: [rowNumber], message: "не указан внешний ID документа 1С" });
      return;
    }
    const group = groups.get(data.externalId) ?? [];
    group.push({ rowNumber, data });
    groups.set(data.externalId, group);
  });

  const documents: OnecDocumentGroup[] = [];
  for (const [externalId, group] of groups) {
    const rowNumbers = group.map((g) => g.rowNumber);
    const fail = (message: string) => errors.push({ externalId, rowNumbers, message });

    const header = {} as Record<HeaderField, unknown>;
    let conflict: string | null = null;
    for (const field of HEADER_FIELDS) {
      const filled = group.filter((g) => g.data[field] !== null);
      header[field] = filled[0]?.data[field] ?? null;
      const other = filled.find((g) => !sameValue(g.data[field], filled[0].data[field]));
      if (other && !conflict) {
        conflict = `поле «${HEADER_LABELS[field]}» различается в строках ${filled[0].rowNumber} и ${other.rowNumber}`;
      }
    }
    if (conflict) {
      fail(conflict);
      continue;
    }
    const h = header as OnecHeader;
    if (!h.number || !h.date) {
      fail("не заполнены номер или дата документа");
      continue;
    }
    if (!h.documentType || !ONEC_DOCUMENT_TYPES.has(h.documentType)) {
      fail(`неизвестный тип документа «${h.documentType ?? ""}»`);
      continue;
    }
    if (!h.direction || !ONEC_DIRECTIONS.has(h.direction)) {
      fail(`направление должно быть INCOME или EXPENSE, получено «${h.direction ?? ""}»`);
      continue;
    }
    if (!h.organizationInn || !h.counterpartyInn) {
      fail("не указаны ИНН организации или контрагента");
      continue;
    }

    const badLine = group.find((g) => !g.data.amount || !g.data.pnlArticleCode);
    if (badLine) {
      fail(`в строке ${badLine.rowNumber} нет суммы или статьи ОПиУ`);
      continue;
    }

    documents.push({
      externalId,
      rowNumbers,
      header: h,
      lines: group.map((g) => ({
        rowNumber: g.rowNumber,
        amount: g.data.amount!,
        vatAmount: g.data.vatAmount,
        pnlArticleCode: g.data.pnlArticleCode!,
        description: g.data.lineDescription,
        departmentName: g.data.departmentName,
        costCenterName: g.data.costCenterName,
        projectName: g.data.projectName,
        productServiceName: g.data.productServiceName,
      })),
    });
  }

  return { documents, errors };
}
