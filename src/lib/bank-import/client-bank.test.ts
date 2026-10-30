import { describe, expect, it } from "vitest";
import { isClientBankExchange, parseClientBankStatement, stripRequisites } from "./client-bank";

const ACCOUNT = "40702810332430001489";

function statement(docs: string[]): Buffer {
  const text = [
    "1CClientBankExchange",
    "ВерсияФормата=1.03",
    "Кодировка=Windows",
    "Отправитель=Альфа-Бизнес Онлайн",
    "ДатаНачала=01.09.2026",
    "ДатаКонца=30.09.2026",
    `РасчСчет=${ACCOUNT}`,
    "СекцияРасчСчет",
    `РасчСчет=${ACCOUNT}`,
    "НачальныйОстаток=4995.73",
    "КонецРасчСчет",
    ...docs,
    "КонецФайла",
  ].join("\r\n");
  // Банки выгружают в Windows-1251; парсер распознаёт её по невалидному UTF-8.
  const bytes = [...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 128) return code;
    if (ch === "Ё") return 0xa8;
    if (ch === "ё") return 0xb8;
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0;
    if (ch === "№") return 0xb9;
    return 0x3f;
  });
  return Buffer.from(bytes);
}

const inflow = [
  "СекцияДокумент=Платежное поручение",
  "Номер=512",
  "Дата=16.09.2026",
  "Сумма=13800.00",
  "ПлательщикСчет=40702810000000000001",
  "ДатаСписано=",
  'Плательщик=ООО "ПТФ "КОНСИС"',
  "ПлательщикИНН=7805068406",
  `ПолучательСчет=${ACCOUNT}`,
  "ДатаПоступило=22.09.2026",
  'Получатель=ООО "ПРОМТЕХНОСФЕРА"',
  "ПолучательИНН=7805757131",
  'ПолучательБанк1=ФИЛИАЛ "САНКТ-ПЕТЕРБУРГСКИЙ" АО "АЛЬФА-БАНК" г Санкт-Петербург',
  "ПолучательБИК=044030786",
  "НазначениеПлатежа=ОПЛАТА ПО СЧЕТУ №260115-1609",
  "КонецДокумента",
];

const outflow = [
  "СекцияДокумент=Платежное поручение",
  "Номер=116",
  "Дата=30.09.2026",
  "Сумма=192.90",
  `ПлательщикСчет=${ACCOUNT}`,
  "ДатаСписано=30.09.2026",
  'Плательщик=ООО "ПРОМТЕХНОСФЕРА"',
  "ПлательщикИНН=7805757131",
  "ПолучательСчет=40702810532310003129",
  'Получатель=ООО "АТЕК-СР"//40702810570010318862/MODBRU22XXX/30109810700000000620',
  "ПолучательИНН=7813524123",
  "НазначениеПлатежа=Оплата",
  "КонецДокумента",
];

describe("parseClientBankStatement", () => {
  it("распознаёт формат, счёт, банк и направление по стороне счёта", () => {
    const buffer = statement([...inflow, ...outflow]);
    expect(isClientBankExchange(buffer)).toBe(true);
    const result = parseClientBankStatement(buffer);
    expect(result.accountNumber).toBe(ACCOUNT);
    expect(result.sender).toBe("Альфа-Бизнес Онлайн");
    expect(result.bik).toBe("044030786");
    expect(result.totalRows).toBe(2);
    expect(result.errorRows).toBe(0);
    const [first, second] = result.operations;
    expect(first).toMatchObject({ direction: "INFLOW", amount: 13800, counterpartyInn: "7805068406", counterpartyName: 'ООО "ПТФ "КОНСИС"', externalRef: null });
    // Дата поступления на счёт, а не дата платёжки.
    expect(first.date.toISOString().slice(0, 10)).toBe("2026-09-22");
    expect(second).toMatchObject({ direction: "OUTFLOW", amount: 192.9, counterpartyInn: "7813524123", counterpartyName: 'ООО "АТЕК-СР"' });
  });

  it("не считает выпиской обычный текстовый файл", () => {
    expect(isClientBankExchange(Buffer.from("Дата;Сумма\n01.09.2026;100"))).toBe(false);
  });

  it("документ без суммы — ошибка строки", () => {
    const broken = inflow.map((line) => (line.startsWith("Сумма=") ? "Сумма=" : line));
    const result = parseClientBankStatement(statement(broken));
    expect(result.operations).toHaveLength(0);
    expect(result.errorRows).toBe(1);
  });
});

describe("stripRequisites", () => {
  it("убирает хвост с расчётным счётом", () => {
    expect(stripRequisites('ООО "КРАСИВЫЙ МИР" Р/С 40702810026070003580')).toBe('ООО "КРАСИВЫЙ МИР"');
    expect(stripRequisites('ООО "АТЕК-СР"//40702810570010318862/MODBRU22XXX/')).toBe('ООО "АТЕК-СР"');
    expect(stripRequisites("ИП Иванов")).toBe("ИП Иванов");
  });
});
