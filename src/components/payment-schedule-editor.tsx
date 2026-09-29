"use client";

import { useState } from "react";
import Decimal from "decimal.js";
import { suggestSplit, MAX_PAYMENT_PARTS, type ScheduleRowInput } from "@/lib/payment-requests/parts";

const money = (value: Decimal) =>
  new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(value.toNumber());

const parse = (raw: string) => {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(cleaned) ? new Decimal(cleaned) : null;
};

/**
 * Строки графика оплаты частями: дата и сумма каждой части. Показывает,
 * сколько ещё не распределено, — сервер всё равно проверит сумму до копейки.
 */
export function PaymentScheduleEditor({
  action,
  toSchedule,
  initialRows,
  todayKey,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Сколько нужно распределить по неоплаченным частям. */
  toSchedule: string;
  initialRows: ScheduleRowInput[];
  todayKey: string;
  submitLabel: string;
}) {
  const [rows, setRows] = useState<ScheduleRowInput[]>(initialRows);
  const target = new Decimal(toSchedule);
  const planned = rows.reduce((sum, r) => sum.plus(parse(r.amount) ?? 0), new Decimal(0));
  const left = target.minus(planned);

  const update = (i: number, patch: Partial<ScheduleRowInput>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const firstDate = rows[0]?.dueDate || todayKey;

  return (
    <form action={action} className="schedule-editor">
      <div className="schedule-editor__rows">
        {rows.map((row, i) => (
          <div key={i} className="schedule-editor__row">
            <input type="hidden" name="partId" value={row.id ?? ""} />
            <span className="schedule-editor__n">{i + 1}</span>
            <label className="field">
              <span>Дата оплаты</span>
              <input type="date" name="partDueDate" id={`part-date-${i}`} min={todayKey} value={row.dueDate} onChange={(e) => update(i, { dueDate: e.target.value })} required />
            </label>
            <label className="field">
              <span>Время</span>
              <input
                type="time"
                name="partDueTime"
                id={`part-time-${i}`}
                value={row.dueTime ?? ""}
                onChange={(e) => update(i, { dueTime: e.target.value })}
                title="Необязательно: когда платёж должен пройти. Пусто — в течение дня"
              />
            </label>
            <label className="field">
              <span>Сумма</span>
              <input
                type="text"
                inputMode="decimal"
                name="partAmount"
                id={`part-amount-${i}`}
                value={row.amount}
                onChange={(e) => update(i, { amount: e.target.value })}
                required
              />
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows((all) => all.filter((_, j) => j !== i))} aria-label={`Убрать часть ${i + 1}`}>
              Убрать
            </button>
          </div>
        ))}
      </div>
      <div className="schedule-editor__footer">
        <span className={left.isZero() ? "text-muted" : "form-error"} style={{ margin: 0 }}>
          {left.isZero()
            ? `Распределено полностью: ${money(target)}`
            : left.greaterThan(0)
              ? `Не распределено: ${money(left)}`
              : `Лишнее: ${money(left.negated())}`}
        </span>
        <div className="schedule-editor__buttons">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={rows.length >= MAX_PAYMENT_PARTS}
            onClick={() => setRows((all) => [...all, { id: null, dueDate: all.at(-1)?.dueDate || todayKey, dueTime: "", amount: left.greaterThan(0) ? left.toFixed(2) : "" }])}
          >
            + Часть
          </button>
          {rows.every((r) => !r.id) ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(suggestSplit(target, firstDate, Math.max(rows.length, 2)))}>
              Поровну
            </button>
          ) : null}
          <button type="submit" className="btn btn-primary btn-sm">
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
