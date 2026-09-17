import { toDecimal } from "./money";
import Decimal from "decimal.js";

export interface ExpectedMovement {
  date: Date;
  amount: number | string;
  direction: "INFLOW" | "OUTFLOW";
}

export interface CalendarRow {
  date: string;
  inflow: Decimal;
  outflow: Decimal;
  balance: Decimal;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildCalendarRows(startingBalance: number | string, movements: ExpectedMovement[]): CalendarRow[] {
  const byDate = new Map<string, { inflow: Decimal; outflow: Decimal }>();

  for (const m of movements) {
    const key = dateKey(m.date);
    const entry = byDate.get(key) ?? { inflow: new Decimal(0), outflow: new Decimal(0) };
    if (m.direction === "INFLOW") {
      entry.inflow = entry.inflow.plus(toDecimal(m.amount));
    } else {
      entry.outflow = entry.outflow.plus(toDecimal(m.amount));
    }
    byDate.set(key, entry);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  let running = toDecimal(startingBalance);
  const rows: CalendarRow[] = [];
  for (const key of sortedDates) {
    const { inflow, outflow } = byDate.get(key)!;
    running = running.plus(inflow).minus(outflow);
    rows.push({ date: key, inflow, outflow, balance: running });
  }
  return rows;
}
