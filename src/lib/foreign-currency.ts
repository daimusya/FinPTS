import { cache } from "react";
import { prisma } from "@/lib/db";
import { BASE_CURRENCY, normalizeCurrency } from "@/lib/currency";

/**
 * Работа с иностранной валютой включается в карточке организации («Работает с
 * иностранной валютой»). Пока ни у одной организации она не включена, валютные
 * функции скрыты: курсы валют в меню, выбор валюты у счетов, касс, документов
 * и заявок, сумма второго счёта в переводе. Если валютные данные уже есть,
 * функции видны, чтобы эти данные не пропали из вида.
 */
export const isForeignCurrencyEnabled = cache(async (): Promise<boolean> => {
  const notRub = { not: BASE_CURRENCY };
  const counts = await Promise.all([
    prisma.organization.count({ where: { usesForeignCurrency: true } }),
    prisma.bankAccount.count({ where: { currency: notRub } }),
    prisma.cashAccount.count({ where: { currency: notRub } }),
    prisma.accrualDocument.count({ where: { currency: notRub } }),
    prisma.paymentRequest.count({ where: { currency: notRub } }),
  ]);
  return counts.some((n) => n > 0);
});

/** Новая валютная запись — только у организации, которая работает с валютой. null — можно. */
export async function currencyNotAllowed(organizationId: string, currencyRaw: unknown): Promise<string | null> {
  const currency = normalizeCurrency(currencyRaw);
  if (currency === BASE_CURRENCY) return null;
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { usesForeignCurrency: true, shortName: true, name: true } });
  if (organization?.usesForeignCurrency) return null;
  return `Организация «${organization?.shortName || organization?.name || "—"}» не работает с иностранной валютой — включите это в её карточке (справочник «Организации и ИП») или укажите рубли`;
}
