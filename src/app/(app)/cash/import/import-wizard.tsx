"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { parseStatementAction, importBankStatementAction, type ParseState, type ImportState } from "./actions";
import { MAPPING_TARGET_LABELS, MAPPING_TARGET_OPTIONS, type MappingTarget } from "@/lib/bank-import/mapping";
import type { FieldOption } from "@/lib/dictionaries/types";

const GUESS_KEYWORDS: Array<[RegExp, MappingTarget]> = [
  [/дата/i, "date"],
  [/приход|поступ|кредит/i, "creditAmount"],
  [/расход|списан|дебет/i, "debitAmount"],
  [/сумма/i, "amount"],
  [/назначен/i, "purpose"],
  [/инн/i, "counterpartyInn"],
  [/контрагент|плательщик|получатель|наименование/i, "counterpartyName"],
  [/номер\s*док|№\s*оп/i, "externalRef"],
];

function guessMapping(headers: string[]): Record<number, MappingTarget> {
  const mapping: Record<number, MappingTarget> = {};
  headers.forEach((header, index) => {
    const match = GUESS_KEYWORDS.find(([re]) => re.test(header));
    if (match) mapping[index] = match[1];
  });
  return mapping;
}

const parseInitialState: ParseState = {};
const importInitialState: ImportState = {};

export function ImportWizard({ bankAccounts }: { bankAccounts: FieldOption[] }) {
  const [parseState, parseAction, parsePending] = useActionState(parseStatementAction, parseInitialState);
  const [importState, importAction, importPending] = useActionState(importBankStatementAction, importInitialState);
  const [mapping, setMapping] = useState<Record<number, MappingTarget> | null>(null);

  const headers = parseState.headers;
  const rows = parseState.rows;

  if (importState.done) {
    return (
      <div className="card">
        <p className="form-success">
          Импорт завершён: загружено {importState.imported}, дубликатов пропущено {importState.duplicates}, ошибок{" "}
          {importState.errors}. Автоклассифицировано по правилам: {importState.autoClassified ?? 0}.
        </p>
        {importState.repeatedImported ? (
          <p className="text-muted" style={{ marginTop: 8 }}>
            Из них {importState.repeatedImported} — повторы уже встречавшейся в файле операции (та же дата, сумма и
            назначение, номера операции банка нет). Они загружены как отдельные операции: при повторной загрузке
            этого же файла дублей не будет.
          </p>
        ) : null}
        {importState.errorSamples && importState.errorSamples.length > 0 ? (
          <ul className="text-muted" style={{ marginTop: 8, paddingLeft: 18 }}>
            {importState.errorSamples.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : null}
        <div className="form-actions">
          <Link href="/cash/transactions" className="btn btn-primary">
            К списку операций
          </Link>
          <Link href="/cash/import" className="btn btn-secondary">
            Загрузить ещё файл
          </Link>
        </div>
      </div>
    );
  }

  if (!headers || !rows) {
    return (
      <div className="card" style={{ maxWidth: 560 }}>
        {parseState.error ? <p className="form-error" style={{ marginBottom: 14 }}>{parseState.error}</p> : null}
        <form action={parseAction}>
          <div className="form-grid">
            <label className="field">
              <span>Банковский счёт *</span>
              <select name="bankAccountId" required defaultValue={parseState.bankAccountId ?? ""}>
                <option value="">— выбрать —</option>
                {bankAccounts.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Файл выписки (XLSX, XLS, CSV, TXT) *</span>
              <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" required />
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={parsePending}>
              {parsePending ? "Разбор файла..." : "Разобрать файл"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const effectiveMapping = mapping ?? guessMapping(headers);

  return (
    <div className="card">
      {importState.error ? <p className="form-error" style={{ marginBottom: 14 }}>{importState.error}</p> : null}
      <p className="text-muted" style={{ marginBottom: 14 }}>
        Файл «{parseState.fileName}»: {parseState.rowCount} строк. Сопоставьте колонки файла с полями операции.
        Ниже показаны первые 5 строк для проверки.
      </p>

      <form action={importAction}>
        <input type="hidden" name="bankAccountId" value={parseState.bankAccountId} />
        <input type="hidden" name="fileName" value={parseState.fileName} />
        <input type="hidden" name="headersJson" value={JSON.stringify(headers)} readOnly />
        <input type="hidden" name="rowsJson" value={JSON.stringify(rows)} readOnly />

        <div className="table-wrap" style={{ marginBottom: 16 }}>
          <table>
            <thead>
              <tr>
                {headers.map((h, index) => (
                  <th key={index}>
                    <div style={{ marginBottom: 6 }}>{h}</div>
                    <select
                      name={`map_${index}`}
                      value={effectiveMapping[index] ?? "ignore"}
                      onChange={(e) =>
                        setMapping({ ...effectiveMapping, [index]: e.target.value as MappingTarget })
                      }
                      style={{ fontWeight: 400, textTransform: "none" }}
                    >
                      {MAPPING_TARGET_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {MAPPING_TARGET_LABELS[opt]}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 5).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {headers.map((_, colIndex) => (
                    <td key={colIndex}>{String(row[colIndex] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={importPending}>
            {importPending ? "Импорт..." : `Импортировать ${rows.length} строк`}
          </button>
          <Link href="/cash/import" className="btn btn-secondary">
            Начать заново
          </Link>
        </div>
      </form>
    </div>
  );
}
