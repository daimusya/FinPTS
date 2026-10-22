import { prisma } from "@/lib/db";

const normName = (v: string) => v.trim().replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е");

/**
 * Один работник — одна карточка в организации: второй работающий сотрудник с
 * тем же ФИО попал бы в расчёт зарплаты дважды. Однофамильцев различают
 * табельные номера — тогда это разные люди. Табельный номер в организации
 * тоже один на работающего человека (уволенного можно принять снова с ним же).
 */
export async function employeeDuplicateProblem(input: {
  id?: string;
  organizationId: string;
  fullName: string;
  personnelNumber: string | null;
}): Promise<string | null> {
  const others = await prisma.employee.findMany({
    where: { organizationId: input.organizationId, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { fullName: true, personnelNumber: true, status: true },
  });
  const number = input.personnelNumber?.trim() || null;
  if (number) {
    // A dismissed employee's number may come back with the same person rehired.
    const sameNumber = others.find((e) => e.status !== "TERMINATED" && e.personnelNumber?.trim() === number);
    if (sameNumber) return `Табельный номер ${number} уже у сотрудника ${sameNumber.fullName} в этой организации`;
  }
  const sameName = others.find((e) => e.status !== "TERMINATED" && normName(e.fullName) === normName(input.fullName));
  if (sameName && !(number && sameName.personnelNumber?.trim() && sameName.personnelNumber.trim() !== number)) {
    return `${sameName.fullName} уже работает в этой организации — вторая карточка попала бы в расчёт зарплаты дважды. Если это другой человек с тем же ФИО, укажите обоим разные табельные номера.`;
  }
  return null;
}
