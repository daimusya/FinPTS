"use client";

import { useActionState } from "react";
import { importClientBankAction, type ClientBankImportState } from "@/app/(app)/cash/import/actions";
import type { FieldOption } from "@/lib/dictionaries/types";

const initialState: ClientBankImportState = {};

/**
 * Загрузка выписок 1С «Клиент-банк» (Альфа-Бизнес Онлайн и др.) в один шаг:
 * можно выбрать сразу несколько файлов, счёт определяется по файлу.
 * organizations — для счёта, которого ещё нет в справочнике; пусто — заводить нельзя.
 */
export function ClientBankUpload({ organizations, compact = false }: { organizations: FieldOption[]; compact?: boolean }) {
  const [state, action, pending] = useActionState(importClientBankAction, initialState);

  return (
    <div>
      <form action={action} className="client-bank-form">
        <label className="field" style={{ flex: "1 1 260px" }}>
          <span>Файлы выписки 1С (.txt) — можно несколько</span>
          <input type="file" name="files" accept=".txt" multiple required />
        </label>
        {organizations.length > 1 ? (
          <label className="field" style={{ flex: "0 1 240px" }}>
            <span>Организация для нового счёта</span>
            <select name="organizationId" defaultValue={organizations[0].value}>
              {organizations.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        ) : organizations.length === 1 ? (
          <input type="hidden" name="organizationId" value={organizations[0].value} />
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Загрузка…" : "Загрузить выписку"}
        </button>
      </form>
      {compact ? null : (
        <p className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
          В Альфа-Бизнес Онлайн: «Выписка» → «Экспорт» → «1С». Повторная загрузка того же периода дублей не создаёт.
        </p>
      )}
      {state.error ? <p className="form-error" style={{ marginTop: 10 }}>{state.error}</p> : null}
      {state.results ? (
        <ul className="client-bank-results">
          {state.results.map((r, i) => (
            <li key={`${r.fileName}-${i}`} className={r.error ? "form-error" : "form-success"}>
              <b>{r.fileName}</b>
              {r.error ? (
                <> — {r.error}</>
              ) : (
                <>
                  {" "}
                  — счёт {r.accountNumber}, {r.period}: загружено {r.imported}, уже были {r.duplicates}
                  {r.accountCreated ? "; счёт добавлен в справочник" : ""}
                  {r.closedPeriodRows ? `; ${r.closedPeriodRows} операций в закрытых месяцах (${r.closedMonths?.join(", ")}) не загружены` : ""}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
