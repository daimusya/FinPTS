import { describe, expect, it } from "vitest";
import { BANK_COLUMNS, CONTACT_COLUMNS, buildBankDetailRows, planDetails, type OwnerCandidate } from "./details-sheets";

const owners: OwnerCandidate[] = [
  { ref: "cp1", inn: "7707083893", names: ["ПАО Сбербанк", "Сбербанк"] },
  { ref: "cp2", inn: null, names: ["ООО Лютик"] },
  { ref: "new:5", inn: "7736207543", names: ["ООО Новая"] },
];
const acc = "40702810000000000001";

const plan = (bankRows: Array<Array<string | null>>, contactRows: Array<Array<string | null>> = [], mode: "upsert" | "create-only" = "upsert") =>
  planDetails({
    bankSheet: { headers: [...BANK_COLUMNS], rows: bankRows },
    contactSheet: { headers: [...CONTACT_COLUMNS], rows: contactRows },
    owners,
    bankDetails: [{ id: "b1", counterpartyId: "cp1", bankName: "Сбербанк", account: acc, bik: "044525225", corrAccount: null, isPrimary: true }],
    contacts: [{ id: "k1", counterpartyId: "cp2", name: "Иванова Мария", position: null, phone: null, email: null }],
    mode,
  });

describe("buildBankDetailRows", () => {
  it("exports the owner's ID, INN and name with each account", () => {
    const rows = buildBankDetailRows([
      { bankName: "Сбербанк", account: acc, bik: "044525225", corrAccount: null, isPrimary: true, counterparty: { id: "cp1", inn: "7707083893", fullName: "ПАО Сбербанк", shortName: "Сбербанк" } },
    ]);
    expect(rows[1]).toEqual(["cp1", "7707083893", "Сбербанк", "Сбербанк", acc, "044525225", "", "да"]);
  });
});

describe("planDetails", () => {
  it("re-importing the same account is unchanged; new accounts go to existing or new counterparties", () => {
    const p = plan([
      ["cp1", "", "", "Сбербанк", acc, "044525225", "", "да"],
      ["", "7736207543", "", "Т-Банк", "4070 2810 0000 0000 0002", "044525974", "", "да"],
      ["", "", "ооо лютик", "Альфа-Банк", "40702810000000000003", "", "", ""],
    ]);
    expect(p.errors).toEqual([]);
    expect(p.unchanged).toBe(1);
    expect(p.bankCreates).toEqual([
      { owner: "new:5", data: { bankName: "Т-Банк", account: "40702810000000000002", bik: "044525974", corrAccount: null }, primary: true },
      { owner: "cp2", data: { bankName: "Альфа-Банк", account: "40702810000000000003", bik: null, corrAccount: null }, primary: false },
    ]);
  });

  it("updates the bank name / corr. account and contacts; create-only skips existing rows", () => {
    const p = plan([["", "7707083893", "", "ПАО Сбербанк", acc, "044525225", "30101810400000000225", ""]], [["cp2", "", "", "иванова мария", "Бухгалтер", "", "m@example.com"]]);
    expect(p.bankUpdates).toEqual([{ id: "b1", owner: "cp1", data: { bankName: "ПАО Сбербанк", corrAccount: "30101810400000000225" }, primary: false }]);
    expect(p.contactUpdates).toEqual([{ id: "k1", data: { position: "Бухгалтер", phone: null, email: "m@example.com" } }]);
    const skipped = plan([["cp1", "", "", "Другое имя", acc, "044525225", "", ""]], [], "create-only");
    expect(skipped).toMatchObject({ bankUpdates: [], skipped: 1 });
  });

  it("reports unknown owners, bad requisites, duplicates and two primaries with sheet and line", () => {
    const p = plan(
      [
        ["", "", "ООО Неизвестная", "Банк", "40702810000000000009", "", "", ""],
        ["cp2", "", "", "Банк", "123", "", "", ""],
        ["cp2", "", "", "Банк А", "40702810000000000004", "", "", "да"],
        ["cp2", "", "", "Банк Б", "40702810000000000005", "", "", "да"],
        ["cp2", "", "", "Банк А", "40702810000000000004", "", "", ""],
      ],
      [["cp2", "", "", "", "", "", ""]],
    );
    expect(p.errors).toEqual([
      "Лист «Банковские реквизиты», строка 2: контрагент не найден ни в справочнике, ни на основном листе файла",
      "Лист «Банковские реквизиты», строка 3: Расчётный счёт должен состоять из 20 цифр",
      "Лист «Банковские реквизиты», строка 5: основной счёт контрагента уже отмечен в строке 4",
      "Лист «Банковские реквизиты», строка 6: этот счёт уже есть в строке 4",
      "Лист «Контакты», строка 2: Укажите имя контакта",
    ]);
  });
});
