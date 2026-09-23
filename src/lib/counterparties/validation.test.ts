import { describe, expect, it } from "vitest";
import { validateBankDetail, validateContact } from "./validation";

const validBank = { bankName: "Сбербанк", account: "40702810100000000001", bik: "044525225", corrAccount: "30101810400000000225" };

describe("validateBankDetail", () => {
  it("accepts valid details and strips spaces from numbers", () => {
    const result = validateBankDetail({ ...validBank, account: "4070 2810 1000 0000 0001" });
    expect(result).toEqual({
      value: { bankName: "Сбербанк", account: "40702810100000000001", bik: "044525225", corrAccount: "30101810400000000225" },
    });
  });

  it("turns empty optional BIK and correspondent account into null", () => {
    const result = validateBankDetail({ ...validBank, bik: "", corrAccount: "  " });
    expect(result).toEqual({ value: { bankName: "Сбербанк", account: "40702810100000000001", bik: null, corrAccount: null } });
  });

  it("requires a bank name", () => {
    expect(validateBankDetail({ ...validBank, bankName: "  " })).toEqual({ error: "Укажите название банка" });
  });

  it("requires a 20-digit account", () => {
    expect(validateBankDetail({ ...validBank, account: "" })).toHaveProperty("error");
    expect(validateBankDetail({ ...validBank, account: "4070281010000000000" })).toHaveProperty("error");
    expect(validateBankDetail({ ...validBank, account: "4070281010000000000A" })).toHaveProperty("error");
  });

  it("rejects a malformed BIK or correspondent account when provided", () => {
    expect(validateBankDetail({ ...validBank, bik: "12345" })).toEqual({ error: "БИК должен состоять из 9 цифр" });
    expect(validateBankDetail({ ...validBank, corrAccount: "301018" })).toEqual({
      error: "Корреспондентский счёт должен состоять из 20 цифр",
    });
  });
});

describe("validateContact", () => {
  it("accepts a contact with only a name, turning empty fields into null", () => {
    expect(validateContact({ name: " Иван ", phone: "", email: "", position: "" })).toEqual({
      value: { name: "Иван", phone: null, email: null, position: null },
    });
  });

  it("requires a name", () => {
    expect(validateContact({ name: "", phone: "+7", email: "", position: "" })).toEqual({ error: "Укажите имя контакта" });
  });

  it("rejects a malformed email and accepts a valid one", () => {
    expect(validateContact({ name: "Иван", phone: "", email: "ivan@", position: "" })).toEqual({ error: "Некорректный email" });
    expect(validateContact({ name: "Иван", phone: "", email: "ivan@example.com", position: "Бухгалтер" })).toEqual({
      value: { name: "Иван", phone: null, email: "ivan@example.com", position: "Бухгалтер" },
    });
  });
});
