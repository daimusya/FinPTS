import { Prisma } from "@prisma/client";

export const UNIQUE_VIOLATION_MESSAGE =
  "Такая запись уже есть в справочнике (совпадает код или другое уникальное поле) — измените существующую запись";

/** Нарушение уникального индекса (P2002): дубль кода вида начисления, параметра за год и т.п. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
