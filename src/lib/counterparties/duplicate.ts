import { prisma } from "@/lib/db";

/**
 * Один контрагент — одна карточка: другой контрагент с тем же ИНН и тем же
 * КПП (у ИП и физлиц КПП нет) — это дубль, из-за которого долги, оплаты и
 * проверка повторных заявок расходятся по двум карточкам. Филиал с другим
 * КПП — отдельный контрагент, это допустимо. Архивная карточка тоже
 * считается: её нужно вернуть из архива, а не заводить заново.
 */
export function sameCounterpartyKey(a: { inn: string | null; kpp: string | null }, b: { inn: string | null; kpp: string | null }): boolean {
  const inn = (v: string | null) => (v ?? "").replace(/\s/g, "");
  const kpp = (v: string | null) => (v ?? "").replace(/\s/g, "");
  return inn(a.inn) !== "" && inn(a.inn) === inn(b.inn) && kpp(a.kpp) === kpp(b.kpp);
}

export async function counterpartyDuplicateProblem(data: Record<string, unknown>, before: Record<string, unknown> | null): Promise<string | null> {
  if (data.isArchived === true) return null;
  const inn = String(data.inn ?? "").replace(/\s/g, "");
  if (!inn) return null;
  const kpp = String(data.kpp ?? "").replace(/\s/g, "") || null;
  const candidates = await prisma.counterparty.findMany({
    where: { inn, ...(before?.id ? { id: { not: String(before.id) } } : {}) },
    select: { fullName: true, shortName: true, inn: true, kpp: true, isArchived: true },
  });
  const twin = candidates.find((c) => sameCounterpartyKey(c, { inn, kpp }));
  if (!twin) return null;
  const name = twin.shortName || twin.fullName;
  const key = `ИНН ${inn}${kpp ? `, КПП ${kpp}` : ""}`;
  return twin.isArchived
    ? `Контрагент с ${key} уже есть в архиве — «${name}». Верните его из архива вместо новой карточки.`
    : `Контрагент с ${key} уже есть — «${name}». Используйте его: две карточки одного контрагента разносят долги и оплаты.`;
}
