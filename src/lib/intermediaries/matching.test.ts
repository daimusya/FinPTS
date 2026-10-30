import { describe, expect, it } from "vitest";
import { namesMatch, parseName, payerKey, resolvePayers } from "./matching";

const match = (listName: string, payer: string, inn: string | null = null) => namesMatch(parseName(listName), parseName(payer), inn);

describe("namesMatch", () => {
  it("сравнивает без формы собственности, кавычек и регистра", () => {
    expect(match("ООО ПТФ КонСис", 'ООО "ПТФ "КОНСИС"')).toBe(true);
    expect(match("ООО Ресторан Менеджмент", 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "РЕСТОРАН МЕНЕДЖМЕНТ"')).toBe(true);
    expect(match("ООО СЗ Северная Венеция", 'ООО "СПЕЦИАЛИЗИРОВАННЫЙ ЗАСТРОЙЩИК "СЕВЕРНАЯ ВЕНЕЦИЯ"')).toBe(true);
    expect(match("ООО Трейд", 'ООО "ТРЕЙД ГРУПП"')).toBe(false);
    expect(match("ООО Лайн", 'ООО "СТРОЙ ЛАЙН БЕТОН"')).toBe(false);
  });

  it("прощает опечатку в списке", () => {
    expect(match("ООО СЗ Альернатива", 'ООО "СЗ "АЛЬТЕРНАТИВА"')).toBe(true);
    expect(match("ООО Лифстрой (новый и старый)", 'ООО "ЛИФТСТРОЙ"')).toBe(true);
    expect(match("ООО МКС", 'ООО "МКТ"')).toBe(false);
  });

  it("ИП — по фамилии и инициалам", () => {
    expect(match("ИП Ремизов В.А.", "ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ РЕМИЗОВ ВИТАЛИЙ АЛЕКСАНДРОВИЧ", "472000123869")).toBe(true);
    expect(match("Ип Варфоломеев", "Варфоломеев Иван Петрович (ИП)", "472000123860")).toBe(true);
    expect(match("ИП Ремизов В.А.", "ИП Ремизов Олег Александрович", "472000123869")).toBe(false);
    // Организация с такой же фамилией в названии — не ИП.
    expect(match("ИП Козлов", 'ООО "КОЗЛОВ"', "7801000000")).toBe(false);
  });

  it("различает одноимённые организации по окончанию ИНН", () => {
    expect(match("ООО ПСК инн 105", 'ООО "ПСК"', "7810741105")).toBe(true);
    expect(match("ООО ПСК инн 105", 'ООО "ПСК"', "7813225028")).toBe(false);
    expect(match("ООО АВАНГАРД ИНН 942", 'ООО "АВАНГАРД"', "7800000942")).toBe(true);
  });
});

describe("resolvePayers", () => {
  const intermediaries = [
    { id: "kh", clients: [{ id: "1", name: "ООО Трейд" }, { id: "2", name: "ООО ИССО" }] },
    { id: "gn", clients: [{ id: "3", name: "ООО Олимп" }] },
    { id: "bd", clients: [{ id: "4", name: "ООО Олимп" }] },
  ];

  it("ИНН, закреплённый вручную, главнее названия; «без посредника» исключает", () => {
    const payers = [
      { inn: "7801507557", name: 'ООО "ТРЕЙД"' },
      { inn: "7700000001", name: 'ООО "ТРЕЙД"' },
      { inn: "7700000002", name: "ООО Дежанейро" },
    ];
    const result = resolvePayers(intermediaries, [
      { inn: "7700000001", intermediaryId: null },
      { inn: "7700000002", intermediaryId: "kh" },
    ], payers);
    expect(result.get("7801507557")).toEqual({ kind: "name", intermediaryId: "kh", clientName: "ООО Трейд" });
    expect(result.get("7700000001")).toEqual({ kind: "excluded" });
    expect(result.get("7700000002")).toEqual({ kind: "inn", intermediaryId: "kh" });
  });

  it("любое из наименований одного ИНН относит к посреднику все его поступления", () => {
    const payers = [
      { inn: "7816746195", name: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ИСКУССТВЕННЫЕ СООРУЖЕНИЯ"' },
      { inn: "7816746195", name: 'ООО "ИССО"' },
    ];
    const result = resolvePayers(intermediaries, [], payers);
    expect(result.get(payerKey(payers[0]))).toMatchObject({ kind: "name", intermediaryId: "kh" });
  });

  it("одно название у двух посредников — неоднозначно", () => {
    const result = resolvePayers(intermediaries, [], [{ inn: "7813277971", name: "ООО Олимп" }]);
    expect(result.get("7813277971")).toMatchObject({ kind: "ambiguous", intermediaryIds: ["gn", "bd"] });
  });
});
