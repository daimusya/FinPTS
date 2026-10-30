"use client";

import { useActionState, useState } from "react";
import {
  importIntermediaryListAction,
  saveIntermediaryAction,
  saveStandardScaleAction,
  type IntermediaryFormState,
  type ListImportState,
  type ScaleFormState,
} from "./actions";

export function IntermediaryListUpload() {
  const [state, action, pending] = useActionState(importIntermediaryListAction, {} as ListImportState);
  return (
    <div>
      <form action={action} className="client-bank-form">
        <label className="field" style={{ flex: "1 1 260px" }}>
          <span>Список посредников (Word .docx): «Посредник 20% | Список организаций»</span>
          <input type="file" name="file" accept=".docx" required />
        </label>
        <button type="submit" className="btn btn-secondary" disabled={pending}>
          {pending ? "Чтение…" : "Загрузить список"}
        </button>
      </form>
      {state.error ? <p className="form-error" style={{ marginTop: 10 }}>{state.error}</p> : null}
      {state.message ? <p className="form-success" style={{ marginTop: 10 }}>{state.message}</p> : null}
    </div>
  );
}

export function IntermediaryForm({
  intermediary,
  firstRateChange,
}: {
  intermediary?: {
    id: string;
    name: string;
    reportName: string | null;
    commissionPct: string | null;
    category: "VIP" | "STANDARD";
    /** ГГГГ-ММ-ДД или пусто. */
    turnoverFrom: string;
  };
  /** «15.07.2026» — ставку меняли с даты: поле задаёт ставку до этого дня. */
  firstRateChange?: string;
}) {
  const [state, action, pending] = useActionState(saveIntermediaryAction, {} as IntermediaryFormState);
  const [category, setCategory] = useState(intermediary?.category ?? "STANDARD");
  return (
    <form action={action}>
      <input type="hidden" name="id" value={intermediary?.id ?? ""} />
      <div className="form-grid">
        <label className="field">
          <span>Посредник *</span>
          <input name="name" required defaultValue={intermediary?.name ?? ""} placeholder="Харламова" />
        </label>
        <label className="field">
          <span>Как назвать в отчёте</span>
          <input name="reportName" defaultValue={intermediary?.reportName ?? ""} placeholder="Харламова Светлана" />
        </label>
        <label className="field">
          <span>Категория</span>
          <select name="category" id="intermediary-category" value={category} onChange={(e) => setCategory(e.target.value as "VIP" | "STANDARD")}>
            <option value="STANDARD">Стандарт — по шкале от оборота</option>
            <option value="VIP">ВИП — ставка по согласованию</option>
          </select>
        </label>
        {category === "VIP" ? (
          <label className="field">
            <span>{firstRateChange ? `Ставка до ${firstRateChange}, %` : "Комиссия, %"}</span>
            <input name="commissionPct" id="intermediary-pct" inputMode="decimal" defaultValue={intermediary?.commissionPct ?? ""} placeholder="20" />
          </label>
        ) : (
          <label className="field">
            <span>Оборот копится с</span>
            <input type="date" name="turnoverFrom" id="intermediary-turnover-from" defaultValue={intermediary?.turnoverFrom ?? ""} />
          </label>
        )}
      </div>
      {category === "STANDARD" ? (
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Ставка — по шкале «Стандарт» от оборота накопительным итогом с этой даты (пусто — с первой оплаты). Шкала общая, правится
          в справочнике посредников.
        </p>
      ) : null}
      {state.error ? <p className="form-error" style={{ marginTop: 10 }}>{state.error}</p> : null}
      {state.saved ? <p className="form-success" style={{ marginTop: 10 }}>Сохранено</p> : null}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Сохранение…" : intermediary ? "Сохранить" : "Добавить посредника"}
        </button>
      </div>
    </form>
  );
}

/** Шкала «Стандарта»: ступени «до, ₽» и «%»; пустая строка — чтобы добавить ступень. */
export function StandardScaleForm({ tiers }: { tiers: Array<{ upTo: string; pct: string }> }) {
  const [state, action, pending] = useActionState(saveStandardScaleAction, {} as ScaleFormState);
  const rows = [...tiers, { upTo: "", pct: "" }];
  return (
    <form action={action}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ступень</th>
              <th>Накопленный оборот до, ₽ (включительно)</th>
              <th>Ставка, %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="text-muted">{i < tiers.length ? i + 1 : "новая"}</td>
                <td>
                  <input name={`upTo_${i}`} id={`scale-up-to-${i}`} inputMode="decimal" defaultValue={row.upTo} placeholder={i === rows.length - 1 ? "" : "без ограничения"} aria-label={`Граница ступени ${i + 1}`} />
                </td>
                <td>
                  <input name={`pct_${i}`} id={`scale-pct-${i}`} inputMode="decimal" defaultValue={row.pct} aria-label={`Ставка ступени ${i + 1}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
        У последней ступени граница пустая — она действует для любого большего оборота. Чтобы убрать ступень, очистите её поля.
        Новая шкала применяется ко всем расчётам «Стандарта», в том числе за прошедшие месяцы.
      </p>
      {state.error ? <p className="form-error" style={{ marginTop: 10 }}>{state.error}</p> : null}
      {state.saved ? <p className="form-success" style={{ marginTop: 10 }}>Шкала сохранена</p> : null}
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Сохранение…" : "Сохранить шкалу"}
        </button>
      </div>
    </form>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      Печать
    </button>
  );
}
