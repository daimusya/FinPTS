"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/permissions";
import { accountCurrencies, loadCbrRates } from "@/lib/currency-rates";
import { normalizeCurrency } from "@/lib/currency";

const DAY = 86_400_000;
const back = (param: "importResult" | "ratesError", message: string): never =>
  redirect(`/master-data/currency-rates?${param}=${encodeURIComponent(message)}#cbr`);

/**
 * Загрузить официальные курсы ЦБ РФ за период: для валют счетов и касс и
 * отмеченных в форме. Период — не больше 5 лет (история для операций
 * прошлых лет); курсы, введённые вручную, не перезаписываются.
 */
export async function loadCbrRatesAction(formData: FormData) {
  const session = await requirePermission(PERMISSIONS.MASTERDATA_MANAGE);
  const fromRaw = String(formData.get("from") ?? "");
  const toRaw = String(formData.get("to") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) back("ratesError", "Укажите период: с какой и по какую дату");
  const from = new Date(`${fromRaw}T00:00:00Z`);
  const to = new Date(`${toRaw}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) back("ratesError", "Такой даты нет в календаре");
  if (to < from) back("ratesError", "Дата окончания раньше даты начала");
  if (to.getTime() - from.getTime() > 5 * 366 * DAY) back("ratesError", "Период — не больше 5 лет за раз");
  if (to.getTime() > Date.now() + DAY) back("ratesError", "Курсы ЦБ устанавливаются не дальше чем на завтра");

  const chosen = formData.getAll("currency").map(normalizeCurrency);
  const currencies = [...new Set([...(await accountCurrencies()), ...chosen])];
  if (currencies.length === 0) back("ratesError", "Все счета и кассы в рублях — отметьте валюты, курсы которых нужны");

  let result: Awaited<ReturnType<typeof loadCbrRates>>;
  try {
    result = await loadCbrRates(from, to, currencies);
  } catch (error) {
    back("ratesError", `Не удалось получить курсы с сайта ЦБ РФ: ${error instanceof Error ? error.message : String(error)}. Повторите позже или введите курс вручную.`);
  }
  await logAudit({
    userId: session.userId,
    entityType: "currency_rate",
    entityId: "cbr",
    action: "load_cbr",
    after: { from: fromRaw, to: toRaw, currencies, saved: result!.saved, unknown: result!.unknown } as never,
  });
  revalidatePath("/master-data/currency-rates");
  const unknown = result!.unknown.length ? ` ЦБ не устанавливает курс: ${result!.unknown.join(", ")} — введите вручную.` : "";
  back("importResult", `Курсы ЦБ РФ загружены: ${result!.currencies.join(", ") || "—"}, записей ${result!.saved}.${unknown}`);
}
