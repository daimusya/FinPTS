export type OnecMappingTarget =
  | "externalId"
  | "organizationInn"
  | "counterpartyInn"
  | "counterpartyName"
  | "documentType"
  | "direction"
  | "number"
  | "date"
  | "dueDate"
  | "amount"
  | "vatAmount"
  | "pnlArticleCode"
  | "comment"
  | "lineDescription"
  | "departmentName"
  | "costCenterName"
  | "projectName"
  | "productServiceName"
  | "ignore";

export const ONEC_MAPPING_LABELS: Record<OnecMappingTarget, string> = {
  externalId: "Внешний ID документа 1С (обязательно)",
  organizationInn: "ИНН организации (обязательно)",
  counterpartyInn: "ИНН контрагента (обязательно)",
  counterpartyName: "Наименование контрагента",
  documentType: "Тип документа (INVOICE/ACT/UPD/WAYBILL/SALE/RECEIPT/RETURN/CORRECTION)",
  direction: "Направление (INCOME/EXPENSE)",
  number: "Номер документа (обязательно)",
  date: "Дата документа (обязательно)",
  dueDate: "Срок оплаты",
  amount: "Сумма (обязательно)",
  vatAmount: "в т.ч. НДС",
  pnlArticleCode: "Код или название статьи ОПиУ (обязательно)",
  comment: "Комментарий",
  lineDescription: "Строка: содержание / номенклатура",
  departmentName: "Строка: подразделение",
  costCenterName: "Строка: ЦФО",
  projectName: "Строка: проект",
  productServiceName: "Строка: продукт / услуга",
  ignore: "— не использовать —",
};

export const ONEC_MAPPING_OPTIONS: OnecMappingTarget[] = [
  "ignore",
  "externalId",
  "organizationInn",
  "counterpartyInn",
  "counterpartyName",
  "documentType",
  "direction",
  "number",
  "date",
  "dueDate",
  "amount",
  "vatAmount",
  "pnlArticleCode",
  "comment",
  "lineDescription",
  "departmentName",
  "costCenterName",
  "projectName",
  "productServiceName",
];

export const ONEC_REQUIRED_TARGETS: OnecMappingTarget[] = [
  "externalId",
  "organizationInn",
  "counterpartyInn",
  "documentType",
  "direction",
  "number",
  "date",
  "amount",
  "pnlArticleCode",
];

export type OnecColumnMapping = Record<number, OnecMappingTarget>;

function cellToString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function parseDateCell(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  const ruMatch = str.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})$/);
  if (ruMatch) {
    const [, d, m, y] = ruMatch;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseAmountCell(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/\s/g, "").replace(/[^\d,.\-]/g, "").replace(",", ".");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

export interface ExtractedOnecRow {
  externalId: string | null;
  organizationInn: string | null;
  counterpartyInn: string | null;
  counterpartyName: string | null;
  documentType: string | null;
  direction: string | null;
  number: string | null;
  date: Date | null;
  dueDate: Date | null;
  amount: number | null;
  vatAmount: number | null;
  pnlArticleCode: string | null;
  comment: string | null;
  lineDescription: string | null;
  departmentName: string | null;
  costCenterName: string | null;
  projectName: string | null;
  productServiceName: string | null;
}

export function extractOnecRow(row: Array<string | number | null>, mapping: OnecColumnMapping): ExtractedOnecRow {
  const result: ExtractedOnecRow = {
    externalId: null,
    organizationInn: null,
    counterpartyInn: null,
    counterpartyName: null,
    documentType: null,
    direction: null,
    number: null,
    date: null,
    dueDate: null,
    amount: null,
    vatAmount: null,
    pnlArticleCode: null,
    comment: null,
    lineDescription: null,
    departmentName: null,
    costCenterName: null,
    projectName: null,
    productServiceName: null,
  };

  for (const [indexStr, target] of Object.entries(mapping)) {
    const index = Number(indexStr);
    const cell = row[index] ?? null;
    switch (target) {
      case "externalId":
        result.externalId = cellToString(cell);
        break;
      case "organizationInn":
        result.organizationInn = cellToString(cell)?.replace(/\D/g, "") ?? null;
        break;
      case "counterpartyInn":
        result.counterpartyInn = cellToString(cell)?.replace(/\D/g, "") ?? null;
        break;
      case "counterpartyName":
        result.counterpartyName = cellToString(cell);
        break;
      case "documentType":
        result.documentType = cellToString(cell)?.toUpperCase() ?? null;
        break;
      case "direction":
        result.direction = cellToString(cell)?.toUpperCase() ?? null;
        break;
      case "number":
        result.number = cellToString(cell);
        break;
      case "date":
        result.date = parseDateCell(cell);
        break;
      case "dueDate":
        result.dueDate = parseDateCell(cell);
        break;
      case "amount":
        result.amount = parseAmountCell(cell);
        break;
      case "vatAmount":
        result.vatAmount = parseAmountCell(cell);
        break;
      case "pnlArticleCode":
        result.pnlArticleCode = cellToString(cell);
        break;
      case "comment":
        result.comment = cellToString(cell);
        break;
      case "lineDescription":
      case "departmentName":
      case "costCenterName":
      case "projectName":
      case "productServiceName":
        result[target] = cellToString(cell);
        break;
      default:
        break;
    }
  }

  return result;
}
