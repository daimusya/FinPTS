export interface BankDetailInput {
  bankName: string;
  account: string;
  bik: string;
  corrAccount: string;
}

export interface NormalizedBankDetail {
  bankName: string;
  account: string;
  bik: string | null;
  corrAccount: string | null;
}

function digitsOnly(value: string): string {
  return value.replace(/\s+/g, "");
}

/**
 * Проверяет и нормализует банковские реквизиты контрагента: пробелы из
 * номеров убираются (их часто вставляют как «4070 2810 …»), расчётный и
 * корреспондентский счёт — 20 цифр, БИК — 9 цифр. Необязательные поля
 * (БИК, корр. счёт) пустыми превращаются в null.
 */
export function validateBankDetail(input: BankDetailInput): { error: string } | { value: NormalizedBankDetail } {
  const bankName = input.bankName.trim();
  const account = digitsOnly(input.account);
  const bik = digitsOnly(input.bik);
  const corrAccount = digitsOnly(input.corrAccount);

  if (!bankName) return { error: "Укажите название банка" };
  if (!/^\d{20}$/.test(account)) return { error: "Расчётный счёт должен состоять из 20 цифр" };
  if (bik && !/^\d{9}$/.test(bik)) return { error: "БИК должен состоять из 9 цифр" };
  if (corrAccount && !/^\d{20}$/.test(corrAccount)) return { error: "Корреспондентский счёт должен состоять из 20 цифр" };

  return { value: { bankName, account, bik: bik || null, corrAccount: corrAccount || null } };
}

export interface ContactInput {
  name: string;
  phone: string;
  email: string;
  position: string;
}

export interface NormalizedContact {
  name: string;
  phone: string | null;
  email: string | null;
  position: string | null;
}

export function validateContact(input: ContactInput): { error: string } | { value: NormalizedContact } {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim();
  const position = input.position.trim();

  if (!name) return { error: "Укажите имя контакта" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Некорректный email" };

  return { value: { name, phone: phone || null, email: email || null, position: position || null } };
}
