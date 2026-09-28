"use client";

import Link from "next/link";
import { useState, useTransition, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { assignCalendarAccountAction, moveCalendarItemAction } from "@/app/(app)/payment-calendar/actions";

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

export type BoardItemKind = "request" | "part" | "document";

export interface BoardItem {
  kind: BoardItemKind;
  id: string;
  href: string;
  dueDate: string;
  direction: "INFLOW" | "OUTFLOW";
  amount: string;
  amountFull: string;
  /** Контрагент. */
  title: string;
  /** «Заявка · Согласована», «Часть 2 из 3 · Согласована», «Счёт № 15 · к получению». */
  subtitle: string;
  organizationId: string;
  organization: string;
  article: string | null;
  look: "approved" | "pending" | "done" | "doc-in" | "doc-out";
  counted: boolean;
  movable: boolean;
  /** В выбранном срезе по счёту: платёж этой организации без счёта оплаты. */
  unassigned: boolean;
  accountKey: string | null;
  accountName: string | null;
}

export interface AccountOption {
  key: string;
  label: string;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const OVERDUE_SHOWN = 40;

const showDate = (key: string) => new Date(`${key}T00:00:00Z`).toLocaleDateString("ru-RU", { timeZone: "UTC" });
const itemKey = (item: BoardItem) => `${item.kind}:${item.id}`;

/**
 * Сетка платёжного календаря: заявки, их части и документы начислений можно
 * перетаскивать на другой день (мышью) или выбрать платёж и указать дату и
 * счёт оплаты (клавиатура, телефон). Изменение сохраняется сразу; остатки
 * пересчитывает сервер после обновления страницы.
 */
export function PaymentCalendarBoard({
  weeks,
  items,
  todayKey,
  accountsByOrganization,
}: {
  weeks: BoardDay[][];
  items: BoardItem[];
  todayKey: string;
  accountsByOrganization: Record<string, AccountOption[]>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Optimistic positions until the server data arrives.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pickedDate, setPickedDate] = useState("");
  const [pickedAccount, setPickedAccount] = useState("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Fresh server data (after router.refresh) replaces the optimistic positions.
  const [seenItems, setSeenItems] = useState(items);
  if (seenItems !== items) {
    setSeenItems(items);
    setMoved({});
  }

  const dateOf = (item: BoardItem) => moved[itemKey(item)] ?? item.dueDate;
  const isOverdue = (item: BoardItem) => item.movable && dateOf(item) < todayKey;
  const overdue = items.filter((i) => isOverdue(i) && !i.unassigned);
  const unassigned = items.filter((i) => i.unassigned);
  const byDate = new Map<string, BoardItem[]>();
  for (const item of items) {
    if (isOverdue(item) || item.unassigned) continue;
    const list = byDate.get(dateOf(item)) ?? [];
    list.push(item);
    byDate.set(dateOf(item), list);
  }
  const selected = items.find((i) => itemKey(i) === selectedKey) ?? null;

  function run(action: () => Promise<{ ok: boolean; message?: string; error?: string }>, onError?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        onError?.();
        setMessage({ kind: "error", text: result.error ?? "Не удалось сохранить" });
        return;
      }
      setMessage({ kind: "ok", text: result.message ?? "Сохранено" });
      router.refresh();
    });
  }

  function move(item: BoardItem, date: string) {
    if (!item.movable || date === dateOf(item)) return;
    if (date < todayKey) {
      setMessage({ kind: "error", text: "Срок оплаты нельзя перенести в прошлое" });
      return;
    }
    const key = itemKey(item);
    setMoved((m) => ({ ...m, [key]: date }));
    run(
      () => moveCalendarItemAction(item.kind, item.id, date),
      () =>
        setMoved((m) => {
          const rest = { ...m };
          delete rest[key];
          return rest;
        }),
    );
  }

  const onDragStart = (item: BoardItem) => (e: DragEvent) => {
    e.dataTransfer.setData("text/plain", itemKey(item));
    e.dataTransfer.effectAllowed = "move";
    setDraggingKey(itemKey(item));
  };
  const onDragEnd = () => {
    setDraggingKey(null);
    setOverDate(null);
  };
  const dropProps = (day: BoardDay) =>
    !day.isPast
      ? {
          onDragOver: (e: DragEvent) => {
            if (!draggingKey) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (overDate !== day.date) setOverDate(day.date);
          },
          onDragLeave: () => setOverDate((d) => (d === day.date ? null : d)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            const key = e.dataTransfer.getData("text/plain") || draggingKey;
            const item = items.find((i) => itemKey(i) === key);
            onDragEnd();
            if (item) move(item, day.date);
          },
        }
      : {};

  const card = (item: BoardItem) => {
    const key = itemKey(item);
    return (
      <button
        key={key}
        type="button"
        className={[
          "pc-request",
          `pc-request--${item.look}`,
          item.counted ? "" : "pc-request--uncounted",
          item.movable ? "pc-request--movable" : "",
          draggingKey === key ? "pc-request--dragging" : "",
          selectedKey === key ? "pc-request--selected" : "",
          moved[key] ? "pc-request--saving" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        draggable={item.movable}
        onDragStart={item.movable ? onDragStart(item) : undefined}
        onDragEnd={item.movable ? onDragEnd : undefined}
        onClick={() => {
          setSelectedKey(key === selectedKey ? null : key);
          setPickedDate(dateOf(item) < todayKey ? todayKey : dateOf(item));
          setPickedAccount(item.accountKey ?? "");
        }}
        title={`${item.title} · ${item.amountFull} · ${item.subtitle}${item.counted ? "" : " · не входит в прогноз"}`}
        aria-pressed={selectedKey === key}
      >
        <span className="pc-request__amount">
          {item.direction === "INFLOW" ? "+" : "−"}
          {item.amount}
        </span>
        <span className="pc-request__who">{item.title}</span>
        <span className="pc-request__status">{item.subtitle}</span>
      </button>
    );
  };

  const selectedAccounts = selected ? (accountsByOrganization[selected.organizationId] ?? []) : [];

  return (
    <div className="pc-board">
      {message ? (
        <p className={message.kind === "ok" ? "form-success" : "form-error"} role="status">
          {message.text}
        </p>
      ) : null}
      {isPending ? (
        <p className="text-muted" role="status">
          Сохраняю…
        </p>
      ) : null}

      {selected ? (
        <div className="card pc-selected">
          <div className="pc-selected__head">
            <strong>
              {selected.title} · {selected.direction === "INFLOW" ? "поступление" : "платёж"} {selected.amountFull}
            </strong>
            <span className="text-muted">
              {selected.subtitle} · {selected.organization}
              {selected.article ? ` · ${selected.article}` : ""} · срок {showDate(dateOf(selected))} · счёт оплаты:{" "}
              {selected.accountName ?? "не назначен"}
            </span>
          </div>
          <div className="pc-selected__actions">
            {selected.movable ? (
              <>
                <label className="field">
                  <span>Перенести на</span>
                  <input type="date" id="pc-move-date" min={todayKey} value={pickedDate} onChange={(e) => setPickedDate(e.target.value)} />
                </label>
                <button type="button" className="btn btn-primary" disabled={!pickedDate || isPending} onClick={() => move(selected, pickedDate)}>
                  Перенести
                </button>
                <label className="field">
                  <span>Счёт оплаты</span>
                  <select id="pc-account" value={pickedAccount} onChange={(e) => setPickedAccount(e.target.value)}>
                    <option value="">— не назначен —</option>
                    {selectedAccounts.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isPending || pickedAccount === (selected.accountKey ?? "")}
                  onClick={() => run(() => assignCalendarAccountAction(selected.kind, selected.id, pickedAccount))}
                >
                  Сохранить счёт
                </button>
              </>
            ) : (
              <span className="text-muted">Срок и счёт этого платежа здесь не меняются (оплачен, отклонён или нет прав).</span>
            )}
            <Link href={selected.href} className="btn btn-ghost">
              Открыть
            </Link>
          </div>
        </div>
      ) : null}

      {overdue.length > 0 ? (
        <div className="card pc-overdue">
          <strong>Просрочено — срок прошёл, а оплаты нет ({overdue.length}).</strong>{" "}
          <span className="text-muted">В прогнозе они считаются на сегодня. Перетащите платёж на день, когда он реально пройдёт.</span>
          <div className="pc-overdue__list">{overdue.slice(0, OVERDUE_SHOWN).map(card)}</div>
          {overdue.length > OVERDUE_SHOWN ? (
            <p className="text-muted">…и ещё {overdue.length - OVERDUE_SHOWN}; полный список — в отчёте о задолженности.</p>
          ) : null}
        </div>
      ) : null}

      {unassigned.length > 0 ? (
        <div className="card pc-unassigned">
          <strong>Счёт оплаты не назначен ({unassigned.length}).</strong>{" "}
          <span className="text-muted">
            Платежи организации этого счёта без счёта оплаты в его прогноз не входят. Выберите платёж и назначьте счёт.
          </span>
          <div className="pc-overdue__list">{unassigned.map(card)}</div>
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
            {day.inflow ? (
              <div className="pc-day__in" title="Поступления за день по прогнозу">
                +{day.inflow}
              </div>
            ) : null}
            {day.outflow ? (
              <div className="pc-day__out" title="Платежи за день по прогнозу">
                −{day.outflow}
              </div>
            ) : null}
            <div className="pc-day__requests">{(byDate.get(day.date) ?? []).map(card)}</div>
            {day.balance ? (
              <div
                className={day.balanceNegative ? "pc-day__balance pc-day__balance--negative" : "pc-day__balance"}
                title={`Остаток на конец дня: ${day.balanceFull}`}
              >
                ост. {day.balance}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
