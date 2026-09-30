/** Подписи полей организации, которые заполняются из ЕГРЮЛ/ЕГРИП, — для сообщения «что изменилось». */
export const ORGANIZATION_REGISTRY_LABELS: Record<string, string> = {
  name: "наименование",
  shortName: "краткое наименование",
  type: "тип (организация / ИП)",
  kpp: "КПП",
  ogrn: "ОГРН",
  legalAddress: "юр. адрес",
  registrationDate: "дата регистрации",
  closureDate: "дата прекращения деятельности",
};
