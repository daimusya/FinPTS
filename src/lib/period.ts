import { prisma } from "./db";
import { PeriodStatus } from "@prisma/client";

export function periodKeyForDate(date: Date): { year: number; month: number } {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/**
 * Периоды создаются по требованию. Отсутствие записи о периоде
 * трактуется как «период открыт» — запись создаётся лениво при
 * первом закрытии.
 */
export async function assertPeriodOpenForDate(date: Date): Promise<void> {
  const { year, month } = periodKeyForDate(date);
  const period = await prisma.accountingPeriod.findUnique({
    where: { year_month: { year, month } },
  });
  if (period && period.status === PeriodStatus.CLOSED) {
    throw new Error(
      `Период ${month}.${year} закрыт для изменений. Требуется повторное открытие.`,
    );
  }
}

export async function getOrCreatePeriod(year: number, month: number) {
  return prisma.accountingPeriod.upsert({
    where: { year_month: { year, month } },
    update: {},
    create: { year, month, status: PeriodStatus.OPEN },
  });
}
