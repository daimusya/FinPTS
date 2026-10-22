import { prisma } from "@/lib/db";
import { sameCounterpartyKey } from "@/lib/counterparties/duplicate";

const digits = (v: unknown) => String(v ?? "").replace(/[\s-]/g, "");

/** Номер своего банковского счёта: 20 цифр (пробелы допустимы). */
export function ownAccountNumberProblem(value: string): string | null {
  return /^\d{20}$/.test(digits(value)) ? null : "номер счёта — 20 цифр";
}

/**
 * Своя организация с тем же ИНН и КПП уже есть: вторая карточка разнесла бы
 * счета, документы и отчёты одной организации по двум.
 */
export async function organizationDuplicateProblem(data: Record<string, unknown>, before: Record<string, unknown> | null): Promise<string | null> {
  if (data.isArchived === true) return null;
  const inn = digits(data.inn);
  if (!inn) return null;
  const kpp = digits(data.kpp) || null;
  const others = await prisma.organization.findMany({
    where: { inn, ...(before?.id ? { id: { not: String(before.id) } } : {}) },
    select: { name: true, shortName: true, inn: true, kpp: true, isArchived: true },
  });
  const twin = others.find((o) => sameCounterpartyKey(o, { inn, kpp }));
  if (!twin) return null;
  const name = twin.shortName || twin.name;
  return twin.isArchived
    ? `Организация с ИНН ${inn}${kpp ? `, КПП ${kpp}` : ""} уже есть в архиве — «${name}». Верните её из архива вместо новой карточки.`
    : `Организация с ИНН ${inn}${kpp ? `, КПП ${kpp}` : ""} уже есть — «${name}».`;
}

/**
 * Тот же счёт (номер и БИК) уже заведён: выписка, загруженная в оба, задвоила
 * бы остатки и движение денег. Счёт не может принадлежать двум организациям.
 */
export async function bankAccountDuplicateProblem(data: Record<string, unknown>, before: Record<string, unknown> | null): Promise<string | null> {
  if (data.isArchived === true) return null;
  const number = digits(data.accountNumber);
  if (!number) return null;
  const bik = digits(data.bik);
  const others = await prisma.bankAccount.findMany({
    where: before?.id ? { id: { not: String(before.id) } } : {},
    select: { accountNumber: true, bik: true, bankName: true, isArchived: true, organization: { select: { name: true, shortName: true } } },
  });
  // Without a BIK on either side the number alone decides (20 digits are practically unique).
  const twin = others.find((a) => digits(a.accountNumber) === number && (!bik || !digits(a.bik) || digits(a.bik) === bik));
  if (!twin) return null;
  const where = `${twin.organization.shortName || twin.organization.name}, ${twin.bankName}`;
  return twin.isArchived
    ? `Счёт ${number} уже есть в архиве (${where}) — верните его из архива вместо нового.`
    : `Счёт ${number} уже заведён (${where}) — второй такой счёт задвоил бы остатки при загрузке выписок.`;
}
