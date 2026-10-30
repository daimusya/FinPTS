import { decodeText } from "./parser";
import type { StatementOperation } from "./import-operations";

/**
 * Выписка в формате обмена 1С «Клиент-банк» (1CClientBankExchange) — так
 * выгружают Альфа-Бизнес Онлайн, Сбер, Точка и большинство банков: текст
 * «Ключ=Значение» в Windows-1251, секция на каждый документ. Колонки
 * сопоставлять не нужно — формат стандартный.
 */
export interface ClientBankStatement {
  /** Расчётный счёт, по которому выписка (РасчСчет). */
  accountNumber: string | null;
  /** Банк-отправитель выписки (Отправитель), например «Альфа-Бизнес Онлайн». */
  sender: string | null;
  /** Банк и БИК счёта — из документов, где он плательщик или получатель. */
  bankName: string | null;
  bik: string | null;
  periodFrom: Date | null;
  periodTo: Date | null;
  operations: StatementOperation[];
  /** Документов в файле. */
  totalRows: number;
  /** Документы без даты или суммы, или не по этому счёту. */
  errorRows: number;
}

export function isClientBankExchange(buffer: Buffer): boolean {
  return buffer.subarray(0, 64).toString("latin1").trimStart().startsWith("1CClientBankExchange");
}

/** Хвост наименования с реквизитами, который дописывают некоторые банки: «… Р/С 40702…», «…//40702…/MODBRU22XXX/…». */
export function stripRequisites(name: string): string {
  return name
    .replace(/\/\/.*$/, "")
    .replace(/\s+Р\/С\s*\d{20}.*$/i, "")
    .trim();
}

function parseDay(value: string | undefined): Date | null {
  const match = value?.trim().match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

const clean = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const validInn = (value: string | undefined): string | null => {
  const inn = value?.trim();
  return inn && /^\d{10}(\d{2})?$/.test(inn) ? inn : null;
};

function readSections(text: string): { header: Record<string, string>; documents: Record<string, string>[] } {
  const header: Record<string, string> = {};
  const documents: Record<string, string>[] = [];
  let current: Record<string, string> | null = null;
  let inAccountSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("СекцияДокумент")) {
      current = { "": line.slice(line.indexOf("=") + 1) };
      continue;
    }
    if (line === "КонецДокумента") {
      if (current) documents.push(current);
      current = null;
      continue;
    }
    if (line === "СекцияРасчСчет") {
      inAccountSection = true;
      continue;
    }
    if (line === "КонецРасчСчет") {
      inAccountSection = false;
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq);
    const value = line.slice(eq + 1);
    if (current) current[key] = value;
    else if (!inAccountSection && !(key in header)) header[key] = value;
  }
  return { header, documents };
}

export function parseClientBankStatement(buffer: Buffer): ClientBankStatement {
  const { header, documents } = readSections(decodeText(buffer));
  const accountNumber = clean(header["РасчСчет"]);
  const operations: StatementOperation[] = [];
  let errorRows = 0;
  let bankName: string | null = null;
  let bik: string | null = null;

  for (const doc of documents) {
    const amount = Number((doc["Сумма"] ?? "").replace(",", ".").replace(/\s/g, ""));
    // Направление — по тому, на чьей стороне наш счёт; без счёта в заголовке — по заполненной дате списания/поступления.
    const inflow = accountNumber
      ? doc["ПолучательСчет"] === accountNumber || doc["ПолучательРасчСчет"] === accountNumber
      : Boolean(clean(doc["ДатаПоступило"]));
    const outflow = accountNumber
      ? doc["ПлательщикСчет"] === accountNumber || doc["ПлательщикРасчСчет"] === accountNumber
      : Boolean(clean(doc["ДатаСписано"]));
    const date = inflow ? parseDay(doc["ДатаПоступило"]) ?? parseDay(doc["Дата"]) : parseDay(doc["ДатаСписано"]) ?? parseDay(doc["Дата"]);
    if (!date || !(amount > 0) || inflow === outflow) {
      errorRows += 1;
      continue;
    }
    const own = inflow ? "Получатель" : "Плательщик";
    if (!bankName) bankName = clean(doc[`${own}Банк1`]);
    if (!bik) bik = clean(doc[`${own}БИК`]);
    const side = inflow ? "Плательщик" : "Получатель";
    // Плательщик=ИНН 7805… ООО «Ромашка» — старая запись 1С с ИНН в начале наименования.
    const rawName = clean(doc[side] ?? doc[`${side}1`])?.replace(/^ИНН\s*\d+\s+/i, "");
    const name = rawName ? stripRequisites(rawName) || rawName : null;
    operations.push({
      date,
      direction: inflow ? "INFLOW" : "OUTFLOW",
      amount,
      purpose: clean(doc["НазначениеПлатежа"]),
      counterpartyInn: validInn(doc[`${side}ИНН`]),
      counterpartyName: name,
      // Без номера операции: отпечаток по дню, сумме и назначению совпадает с операциями из API банка.
      externalRef: null,
    });
  }

  return {
    accountNumber,
    sender: clean(header["Отправитель"]),
    bankName,
    bik,
    periodFrom: parseDay(header["ДатаНачала"]),
    periodTo: parseDay(header["ДатаКонца"]),
    operations,
    totalRows: documents.length,
    errorRows,
  };
}
