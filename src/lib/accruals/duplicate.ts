import { prisma } from "@/lib/db";
import { ACCRUAL_DOCUMENT_TYPE_LABELS, ACCRUAL_STATUS_LABELS } from "@/lib/accruals/labels";

/** Номер документа для сравнения: без «№», пробелов и регистра («№ 15», «15 » и «15» — один номер). */
export function documentNumberKey(number: string): string {
  return number.replace(/№/g, "").replace(/\s/g, "").toLowerCase();
}

/**
 * Тот же документ, внесённый второй раз: та же организация, контрагент,
 * направление, вид документа и номер в том же году (нумерация у контрагентов
 * начинается заново с года) — задвоил бы доход или расход и долг. Отменённые
 * документы не мешают завести документ заново.
 */
export async function accrualDuplicateProblem(input: {
  id?: string;
  organizationId: string;
  counterpartyId: string;
  direction: string;
  documentType: string;
  number: string;
  date: Date;
}): Promise<string | null> {
  const key = documentNumberKey(input.number);
  if (!key) return null;
  const year = input.date.getUTCFullYear();
  const candidates = await prisma.accrualDocument.findMany({
    where: {
      organizationId: input.organizationId,
      counterpartyId: input.counterpartyId,
      direction: input.direction as never,
      documentType: input.documentType as never,
      status: { not: "CANCELLED" },
      date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) },
      ...(input.id ? { id: { not: input.id } } : {}),
    },
    select: { number: true, date: true, status: true },
  });
  const twin = candidates.find((d) => documentNumberKey(d.number) === key);
  if (!twin) return null;
  const type = ACCRUAL_DOCUMENT_TYPE_LABELS[input.documentType] ?? "Документ";
  return `${type} № ${twin.number} от ${twin.date.toLocaleDateString("ru-RU", { timeZone: "UTC" })} от этого контрагента уже внесён (${(ACCRUAL_STATUS_LABELS[twin.status] ?? twin.status).toLowerCase()}) — второй задвоил бы сумму и долг. Если это другой документ, проверьте номер; если повтор — откройте уже внесённый.`;
}
