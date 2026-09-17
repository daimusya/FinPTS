"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { parseOnecFileAction, importOnecFileAction, type OnecParseState, type OnecImportState } from "./actions";
import { ONEC_MAPPING_LABELS, ONEC_MAPPING_OPTIONS, type OnecMappingTarget } from "@/lib/integrations/onec-mapping";

const GUESS_KEYWORDS: Array<[RegExp, OnecMappingTarget]> = [
  [/внешн.*id|guid|идентификатор/i, "externalId"],
  [/инн.*орг|орг.*инн/i, "organizationInn"],
  [/инн.*контр|инн.*контрагент/i, "counterpartyInn"],
  [/наимен.*контрагент|контрагент/i, "counterpartyName"],
  [/тип.*док/i, "documentType"],
  [/направлен/i, "direction"],
  [/номер/i, "number"],
  [/дата/i, "date"],
  [/срок/i, "dueDate"],
  [/сумма/i, "amount"],
  [/ндс/i, "vatAmount"],
  [/стать/i, "pnlArticleCode"],
  [/коммент/i, "comment"],
];

function guessMapping(headers: string[]): Record<number, OnecMappingTarget> {
  const mapping: Record<number, OnecMappingTarget> = {};
  headers.forEach((header, index) => {
    const match = GUESS_KEYWORDS.find(([re]) => re.test(header));
    if (match) mapping[index] = match[1];
  });
  return mapping;
}

const parseInitialState: OnecParseState = {};
const importInitialState: OnecImportState = {};

export function OnecImportWizard() {
  const [parseState, parseAction, parsePending] = useActionState(parseOnecFileAction, parseInitialState);
  const [importState, importAction, importPending] = useActionState(importOnecFileAction, importInitialState);
  const [mapping, setMapping] = useState<Record<number, OnecMappingTarget> | null>(null);

  const headers = parseState.headers;
  const rows = parseState.rows;

  if (importState.done) {
    return (
      <div className="card">
        <p className="form-success">
          Импорт завершён: создано {importState.imported}, обновлено {importState.updated}, ошибок{" "}
          {importState.errors}.
        </p>
        {importState.errorSamples && importState.errorSamples.length > 0 ? (
          <ul className="text-muted" style={{ marginTop: 8, paddingLeft: 18 }}>
            {importState.errorSamples.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : null}
        <div className="form-actions">
          <Link href="/accruals" className="btn btn-primary">
            К документам начисления
          </Link>
          <Link href="/integrations/1c" className="btn btn-secondary">
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
          <label className="field">
            <span>Файл выгрузки из 1С (XLSX, CSV, TXT) *</span>
            <input type="file" name="file" accept=".xlsx,.xls,.csv,.txt" required />
          </label>
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
        Файл «{parseState.fileName}»: {parseState.rowCount} строк. Обязательно сопоставьте: внешний ID, ИНН
        организации, ИНН контрагента, тип документа, направление, номер, дату, сумму, статью ОПиУ.
      </p>

      <form action={importAction}>
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
                      onChange={(e) => setMapping({ ...effectiveMapping, [index]: e.target.value as OnecMappingTarget })}
                      style={{ fontWeight: 400, textTransform: "none" }}
                    >
                      {ONEC_MAPPING_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {ONEC_MAPPING_LABELS[opt]}
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
          <Link href="/integrations/1c" className="btn btn-secondary">
            Начать заново
          </Link>
        </div>
      </form>
    </div>
  );
}
