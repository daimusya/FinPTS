"use client";

import Link from "next/link";
import { useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { movePaymentRequestAction } from "@/app/(app)/payment-requests/actions";

export interface BoardDay {
  date: string;
  day: number;
  weekday: string;
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWorking: boolean;
  holidayName: string | null;
  inflow: string | null;
  outflow: string | null;
  balance: string | null;
  balanceFull: string | null;
  balanceNegative: boolean;
}

export interface BoardRequest {
  id: string;
  dueDate: string;
  amount: string;
  amountFull: string;
  counterparty: string;
  organization: string;
  article: string | null;
  status: string;
  statusLabel: string;
  counted: boolean;
  movable: boolean;
  overdue: boolean;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const showDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });

/**
 * Сетка платёжного календаря: заявки на оплату можно перетаскивать на другой
 * день (мышью) или выбрать заявку и указать дату (клавиатура, телефон).
 * Перенос сохраняется сразу; остатки пересчитывает сервер после обновления.
 */
export function PaymentCalendarBoard({
  weeks,
  requests,
  canMove,
  todayKey,
}: {
  weeks: BoardDay[][];
  requests: BoardRequest[];
  canMove: boolean;
  todayKey: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Optimistic positions until the server data arrives; cleared on every fresh set of props.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickedDate, setPickedDate] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Fresh server data (after router.refresh) replaces the optimistic positions.
  const [seenRequests, setSeenRequests] = useState(requests);
  if (seenRequests !== requests) {
    setSeenRequests(requests);
    setMoved({});
  }

  const dateOf = (r: BoardRequest) => moved[r.id] ?? r.dueDate;
  const isOverdue = (r: BoardRequest) => r.movable && dateOf(r) < todayKey;
  const overdue = requests.filter(isOverdue);
  const byDate = new Map<string, BoardRequest[]>();
  for (const r of requests) {
    if (isOverdue(r)) continue;
    const list = byDate.get(dateOf(r)) ?? [];
    list.push(r);
    byDate.set(dateOf(r), list);
  }
  const selected = requests.find((r) => r.id === selectedId) ?? null;

  function move(request: BoardRequest, date: string) {
    if (!canMove || !request.movable || date === dateOf(request)) return;
    if (date < todayKey) {
      setMessage({ kind: "error", text: "Срок оплаты нельзя перенести в прошлое" });
      return;
    }
    const previous = dateOf(request);
    setMoved((m) => ({ ...m, [request.id]: date }));
    setMessage(null);
    startTransition(async () => {
      const result = await movePaymentRequestAction(request.id, date);
      if (!result.ok) {
        setMoved((m) => {
          const rest = { ...m };
          delete rest[request.id];
          return rest;
        });
        setMessage({ kind: "error", text: result.error });
        return;
      }
      setMessage({
        kind: "ok",
        text: `Заявка ${request.counterparty} на ${request.amountFull} перенесена: ${showDate(previous)} → ${showDate(date)}`,
      });
      router.refresh();
    });
  }

  const onDragStart = (r: BoardRequest) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", r.id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(r.id);
  };
  const onDragEnd = () => {
    setDraggingId(null);
    setOverDate(null);
  };
  const dropProps = (day: BoardDay) =>
    canMove && !day.isPast
      ? {
          onDragOver: (e: DragEvent) => {
            if (!draggingId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overDate !== day.date) setOverDate(day.date);
          },
          onDragLeave: () => setOverDate((d) => (d === day.date ? null : d)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData("text/plain") || draggingId;
            const request = requests.find((r) => r.id === id);
            onDragEnd();
            if (request) move(request, day.date);
          },
        }
      : {};

  const card = (r: BoardRequest) => {
    const draggable = canMove && r.movable;
    return (
      <button
        key={r.id}
        type="button"
        className={[
          "pc-request",
          `pc-request--${r.status.toLowerCase()}`,
          r.counted ? "" : "pc-request--uncounted",
          draggable ? "pc-request--movable" : "",
          draggingId === r.id ? "pc-request--dragging" : "",
          selectedId === r.id ? "pc-request--selected" : "",
          moved[r.id] ? "pc-request--saving" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        draggable={draggable}
        onDragStart={draggable ? onDragStart(r) : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
        onClick={() => {
          setSelectedId(r.id === selectedId ? null : r.id);
          setPickedDate(dateOf(r) < todayKey ? todayKey : dateOf(r));
        }}
        title={`${r.counterparty} · ${r.amountFull} · ${r.statusLabel}${r.counted ? "" : " · не входит в прогноз"}`}
        aria-pressed={selectedId === r.id}
      >
        <span className="pc-request__amount">−{r.amount}</span>
        <span className="pc-request__who">{r.counterparty}</span>
        <span className="pc-request__status">{r.statusLabel}</span>
      </button>
    );
  };

  return (
    <div className="pc-board">
      {message ? (
        <p className={message.kind === "ok" ? "form-success" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
      {isPending ? <p className="text-muted" role="status">Сохраняю перенос…</p> : null}

      {selected ? (
        <div className="card pc-selected">
          <div className="pc-selected__head">
            <strong>
              {selected.counterparty} · {selected.amountFull}
            </strong>
            <span className="text-muted">
              {selected.organization}
              {selected.article ? ` · ${selected.article}` : ""} · {selected.statusLabel} · срок {showDate(dateOf(selected))}
            </span>
          </div>
          <div className="pc-selected__actions">
            {canMove && selected.movable ? (
              <>
                <label className="field">
                  <span>Перенести на</span>
                  <input type="date" id="pc-move-date" min={todayKey} value={pickedDate} onChange={(e) => setPickedDate(e.target.value)} />
                </label>
                <button type="button" className="btn btn-primary" disabled={!pickedDate || isPending} onClick={() => move(selected, pickedDate)}>
                  Перенести
                </button>
              </>
            ) : (
              <span className="text-muted">
                {selected.movable ? "Переносить срок могут согласующие и казначейство." : "Срок этой заявки уже не переносится."}
              </span>
            )}
            <Link href={`/payment-requests/${selected.id}`} className="btn btn-ghost">
              Открыть заявку
            </Link>
          </div>
        </div>
      ) : null}

      {overdue.length > 0 ? (
        <div className="card pc-overdue">
          <strong>Просроченные заявки — срок прошёл, а оплаты нет.</strong>{" "}
          <span className="text-muted">
            В прогнозе они считаются к оплате сегодня. {canMove ? "Перетащите заявку на день, когда её оплатите." : ""}
          </span>
          <div className="pc-overdue__list">{overdue.map(card)}</div>
        </div>
      ) : null}

      <div className="pc-grid" role="grid" aria-label="Платёжный календарь">
        {WEEKDAYS.map((w) => (
          <div key={w} className="pc-weekday" role="columnheader">
            {w}
          </div>
        ))}
        {weeks.flat().map((day) => (
          <div
            key={day.date}
            role="gridcell"
            className={[
              "pc-day",
              day.inMonth ? "" : "pc-day--outside",
              day.isToday ? "pc-day--today" : "",
              day.isPast ? "pc-day--past" : "",
              day.isWorking ? "" : "pc-day--off",
              overDate === day.date ? "pc-day--drop" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            {...dropProps(day)}
          >
            <div className="pc-day__head">
              <span className="pc-day__weekday">{day.weekday}</span>
              <span className="pc-day__num">{day.day}</span>
              {day.isToday ? <span className="pc-day__tag">сегодня</span> : null}
              {day.holidayName ? (
                <span className="pc-day__holiday" title={day.holidayName}>
                  {day.holidayName}
                </span>
              ) : null}
            </div>
            {day.inflow ? <div className="pc-day__in">+{day.inflow}</div> : null}
            {day.outflow ? <div className="pc-day__out">−{day.outflow}</div> : null}
            <div className="pc-day__requests">{(byDate.get(day.date) ?? []).map(card)}</div>
            {day.balance ? (
              <div className={day.balanceNegative ? "pc-day__balance pc-day__balance--negative" : "pc-day__balance"} title={`Остаток на конец дня: ${day.balanceFull}`}>
                ост. {day.balance}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
