export type MappingTarget =
  | "date"
  | "amount"
  | "creditAmount"
  | "debitAmount"
  | "purpose"
  | "counterpartyInn"
  | "counterpartyName"
  | "externalRef"
  | "ignore";

export const MAPPING_TARGET_LABELS: Record<MappingTarget, string> = {
  date: "Дата операции",
  amount: "Сумма (со знаком: + приход, − расход)",
  creditAmount: "Сумма прихода",
  debitAmount: "Сумма расхода",
  purpose: "Назначение платежа",
  counterpartyInn: "ИНН контрагента",
  counterpartyName: "Наименование контрагента",
  externalRef: "Номер операции (банк)",
  ignore: "— не использовать —",
};

export const MAPPING_TARGET_OPTIONS: MappingTarget[] = [
  "ignore",
  "date",
  "amount",
  "creditAmount",
  "debitAmount",
  "purpose",
  "counterpartyInn",
  "counterpartyName",
  "externalRef",
];

export type ColumnMapping = Record<number, MappingTarget>;

function cellToString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function parseDateCell(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const str = String(value).trim();
  // ДД.ММ.ГГГГ
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
  const cleaned = String(value)
    .replace(/\s/g, "")
    .replace(/[^\d,.\-]/g, "")
    .replace(",", ".");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isNaN(num) ? null : num;
}

export interface ExtractedRow {
  date: Date | null;
  amount: number | null;
  direction: "INFLOW" | "OUTFLOW" | null;
  purpose: string | null;
  counterpartyInn: string | null;
  counterpartyName: string | null;
  externalRef: string | null;
}

export function extractRow(row: Array<string | number | null>, mapping: ColumnMapping): ExtractedRow {
  let date: Date | null = null;
  let signedAmount: number | null = null;
  let creditAmount: number | null = null;
  let debitAmount: number | null = null;
  let purpose: string | null = null;
  let counterpartyInn: string | null = null;
  let counterpartyName: string | null = null;
  let externalRef: string | null = null;

  for (const [indexStr, target] of Object.entries(mapping)) {
    const index = Number(indexStr);
    const cell = row[index] ?? null;
    switch (target) {
      case "date":
        date = parseDateCell(cell);
        break;
      case "amount":
        signedAmount = parseAmountCell(cell);
        break;
      case "creditAmount":
        creditAmount = parseAmountCell(cell);
        break;
      case "debitAmount":
        debitAmount = parseAmountCell(cell);
        break;
      case "purpose":
        purpose = cellToString(cell);
        break;
      case "counterpartyInn":
        counterpartyInn = cellToString(cell)?.replace(/\D/g, "") ?? null;
        break;
      case "counterpartyName":
        counterpartyName = cellToString(cell);
        break;
      case "externalRef":
        externalRef = cellToString(cell);
        break;
      default:
        break;
    }
  }

  let amount: number | null = null;
  let direction: "INFLOW" | "OUTFLOW" | null = null;

  if (signedAmount !== null && signedAmount !== 0) {
    amount = Math.abs(signedAmount);
    direction = signedAmount > 0 ? "INFLOW" : "OUTFLOW";
  } else if (creditAmount !== null && creditAmount > 0) {
    amount = creditAmount;
    direction = "INFLOW";
  } else if (debitAmount !== null && debitAmount > 0) {
    amount = debitAmount;
    direction = "OUTFLOW";
  }

  return { date, amount, direction, purpose, counterpartyInn, counterpartyName, externalRef };
}
