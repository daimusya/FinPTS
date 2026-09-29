import { validateBankDetail, validateContact } from "./validation";

/**
 * Листы «Банковские реквизиты» и «Контакты» в выгрузке и загрузке справочника
 * контрагентов. Строка привязывается к контрагенту по ID (из выгрузки), иначе
 * по ИНН, иначе по наименованию — в том числе к контрагенту, который
 * создаётся этим же файлом.
 */
export const BANK_SHEET = "Банковские реквизиты";
export const CONTACT_SHEET = "Контакты";

const OWNER_COLUMNS = ["ID контрагента", "ИНН контрагента", "Контрагент"] as const;
export const BANK_COLUMNS = [...OWNER_COLUMNS, "Банк", "Расчётный счёт", "БИК", "Корр. счёт", "Основной"] as const;
export const CONTACT_COLUMNS = [...OWNER_COLUMNS, "Имя", "Должность", "Телефон", "Email", "Основной"] as const;

type Cell = string | number | null;

export interface OwnerInfo {
  id: string;
  inn: string | null;
  fullName: string;
  shortName: string | null;
}

export function buildBankDetailRows(
  details: Array<{ bankName: string; account: string; bik: string | null; corrAccount: string | null; isPrimary: boolean; counterparty: OwnerInfo }>,
): Array<Array<string>> {
  return [
    [...BANK_COLUMNS],
    ...details.map((d) => [
      d.counterparty.id,
      d.counterparty.inn ?? "",
      d.counterparty.shortName || d.counterparty.fullName,
      d.bankName,
      d.account,
      d.bik ?? "",
      d.corrAccount ?? "",
      d.isPrimary ? "да" : "нет",
    ]),
  ];
}

export function buildContactRows(
  contacts: Array<{ name: string; position: string | null; phone: string | null; email: string | null; isPrimary: boolean; counterparty: OwnerInfo }>,
): Array<Array<string>> {
  return [
    [...CONTACT_COLUMNS],
    ...contacts.map((c) => [
      c.counterparty.id,
      c.counterparty.inn ?? "",
      c.counterparty.shortName || c.counterparty.fullName,
      c.name,
      c.position ?? "",
      c.phone ?? "",
      c.email ?? "",
      c.isPrimary ? "да" : "нет",
    ]),
  ];
}

/** Контрагент, к которому можно привязать строку: существующий (ref = ID) или создаваемый файлом (ref = new:строка). */
export interface OwnerCandidate {
  ref: string;
  inn: string | null;
  names: string[];
}

export interface ExistingBankDetail {
  id: string;
  counterpartyId: string;
  bankName: string;
  account: string;
  bik: string | null;
  corrAccount: string | null;
  isPrimary: boolean;
}

export interface ExistingContact {
  id: string;
  counterpartyId: string;
  name: string;
  position: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}

export interface DetailsPlan {
  bankCreates: Array<{ owner: string; data: { bankName: string; account: string; bik: string | null; corrAccount: string | null }; primary: boolean }>;
  bankUpdates: Array<{ id: string; owner: string; data: { bankName: string; corrAccount: string | null }; primary: boolean }>;
  contactCreates: Array<{ owner: string; data: { name: string; position: string | null; phone: string | null; email: string | null }; primary: boolean }>;
  contactUpdates: Array<{ id: string; owner: string; data: { position: string | null; phone: string | null; email: string | null }; primary: boolean }>;
  unchanged: number;
  skipped: number;
  errors: string[];
}

const norm = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => norm(v).toLowerCase();

function indexer(headers: string[]) {
  const map = new Map(headers.map((h, i) => [lower(String(h).replace(/\*/g, "")), i]));
  return (label: string, row: Cell[]) => {
    const i = map.get(label.toLowerCase());
    return i === undefined ? "" : norm(row[i]);
  };
}

function resolveOwner(
  cell: (label: string, row: Cell[]) => string,
  row: Cell[],
  owners: OwnerCandidate[],
): { ref: string } | { error: string } {
  const id = cell("ID контрагента", row);
  if (id) {
    return owners.some((o) => o.ref === id) ? { ref: id } : { error: `контрагента с ID «${id}» нет` };
  }
  const inn = cell("ИНН контрагента", row).replace(/\s/g, "");
  if (inn) {
    const byInn = owners.filter((o) => o.inn === inn);
    if (byInn.length === 1) return { ref: byInn[0].ref };
    if (byInn.length > 1) return { error: `контрагентов с ИНН ${inn} несколько — укажите «ID контрагента»` };
  }
  const name = lower(cell("Контрагент", row));
  if (name) {
    const byName = owners.filter((o) => o.names.some((n) => n.toLowerCase() === name));
    if (byName.length === 1) return { ref: byName[0].ref };
    if (byName.length > 1) return { error: `контрагентов «${cell("Контрагент", row)}» несколько — укажите ИНН или «ID контрагента»` };
  }
  return { error: inn || name ? "контрагент не найден ни в справочнике, ни на основном листе файла" : "не указан контрагент" };
}

/**
 * План загрузки листов реквизитов и контактов. Реквизиты сопоставляются по
 * (контрагент, расчётный счёт, БИК), контакты — по (контрагент, имя). В
 * режиме «только добавлять» существующие строки не меняются.
 */
export function planDetails(input: {
  bankSheet: { headers: string[]; rows: Cell[][] } | null;
  contactSheet: { headers: string[]; rows: Cell[][] } | null;
  owners: OwnerCandidate[];
  bankDetails: ExistingBankDetail[];
  contacts: ExistingContact[];
  mode: "upsert" | "create-only";
}): DetailsPlan {
  const plan: DetailsPlan = { bankCreates: [], bankUpdates: [], contactCreates: [], contactUpdates: [], unchanged: 0, skipped: 0, errors: [] };

  if (input.bankSheet) {
    const cell = indexer(input.bankSheet.headers);
    const seen = new Map<string, number>();
    const primaryLine = new Map<string, number>();
    input.bankSheet.rows.forEach((row, i) => {
      const line = i + 2;
      if (row.every((c) => norm(c) === "")) return;
      const where = `Лист «${BANK_SHEET}», строка ${line}`;
      const owner = resolveOwner(cell, row, input.owners);
      if ("error" in owner) return void plan.errors.push(`${where}: ${owner.error}`);
      const checked = validateBankDetail({ bankName: cell("Банк", row), account: cell("Расчётный счёт", row), bik: cell("БИК", row), corrAccount: cell("Корр. счёт", row) });
      if ("error" in checked) return void plan.errors.push(`${where}: ${checked.error}`);
      const primaryRaw = lower(cell("Основной", row));
      if (primaryRaw && !["да", "нет"].includes(primaryRaw)) return void plan.errors.push(`${where}: в колонке «Основной» ожидается «да» или «нет»`);
      const primary = primaryRaw === "да";

      const key = `${owner.ref}|${checked.value.account}|${checked.value.bik ?? ""}`;
      if (seen.has(key)) return void plan.errors.push(`${where}: этот счёт уже есть в строке ${seen.get(key)}`);
      seen.set(key, line);
      if (primary) {
        if (primaryLine.has(owner.ref)) return void plan.errors.push(`${where}: основной счёт контрагента уже отмечен в строке ${primaryLine.get(owner.ref)}`);
        primaryLine.set(owner.ref, line);
      }

      const existing = input.bankDetails.find(
        (d) => d.counterpartyId === owner.ref && d.account === checked.value.account && (d.bik ?? "") === (checked.value.bik ?? ""),
      );
      if (!existing) return void plan.bankCreates.push({ owner: owner.ref, data: checked.value, primary });
      if (input.mode === "create-only") return void plan.skipped++;
      const same = existing.bankName === checked.value.bankName && (existing.corrAccount ?? null) === checked.value.corrAccount && (!primary || existing.isPrimary);
      if (same) plan.unchanged++;
      else plan.bankUpdates.push({ id: existing.id, owner: owner.ref, data: { bankName: checked.value.bankName, corrAccount: checked.value.corrAccount }, primary });
    });
  }

  if (input.contactSheet) {
    const cell = indexer(input.contactSheet.headers);
    const seen = new Map<string, number>();
    const primaryLine = new Map<string, number>();
    input.contactSheet.rows.forEach((row, i) => {
      const line = i + 2;
      if (row.every((c) => norm(c) === "")) return;
      const where = `Лист «${CONTACT_SHEET}», строка ${line}`;
      const owner = resolveOwner(cell, row, input.owners);
      if ("error" in owner) return void plan.errors.push(`${where}: ${owner.error}`);
      const checked = validateContact({ name: cell("Имя", row), position: cell("Должность", row), phone: cell("Телефон", row), email: cell("Email", row) });
      if ("error" in checked) return void plan.errors.push(`${where}: ${checked.error}`);
      const primaryRaw = lower(cell("Основной", row));
      if (primaryRaw && !["да", "нет"].includes(primaryRaw)) return void plan.errors.push(`${where}: в колонке «Основной» ожидается «да» или «нет»`);
      const primary = primaryRaw === "да";

      const key = `${owner.ref}|${checked.value.name.toLowerCase()}`;
      if (seen.has(key)) return void plan.errors.push(`${where}: контакт «${checked.value.name}» уже есть в строке ${seen.get(key)}`);
      seen.set(key, line);
      if (primary) {
        if (primaryLine.has(owner.ref)) return void plan.errors.push(`${where}: основной контакт контрагента уже отмечен в строке ${primaryLine.get(owner.ref)}`);
        primaryLine.set(owner.ref, line);
      }

      const existing = input.contacts.find((c) => c.counterpartyId === owner.ref && c.name.toLowerCase() === checked.value.name.toLowerCase());
      if (!existing) return void plan.contactCreates.push({ owner: owner.ref, data: checked.value, primary });
      if (input.mode === "create-only") return void plan.skipped++;
      const { position, phone, email } = checked.value;
      const same =
        (existing.position ?? null) === position && (existing.phone ?? null) === phone && (existing.email ?? null) === email && (!primary || existing.isPrimary);
      if (same) plan.unchanged++;
      else plan.contactUpdates.push({ id: existing.id, owner: owner.ref, data: { position, phone, email }, primary });
    });
  }
  return plan;
}
