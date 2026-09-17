"use client";

import { useState } from "react";
import type { FieldOption } from "@/lib/dictionaries/types";

export interface LineDraft {
  key: string;
  departmentId: string;
  costCenterId: string;
  projectId: string;
  productServiceId: string;
  pnlArticleId: string;
  amount: string;
  vatAmount: string;
  description: string;
}

export interface AccrualLineOptions {
  departments: FieldOption[];
  costCenters: FieldOption[];
  projects: FieldOption[];
  productsServices: FieldOption[];
  pnlArticles: FieldOption[];
}

function emptyLine(): LineDraft {
  return {
    key: Math.random().toString(36).slice(2),
    departmentId: "",
    costCenterId: "",
    projectId: "",
    productServiceId: "",
    pnlArticleId: "",
    amount: "",
    vatAmount: "",
    description: "",
  };
}

export function AccrualLinesEditor({
  options,
  initialLines,
}: {
  options: AccrualLineOptions;
  initialLines?: LineDraft[];
}) {
  const [lines, setLines] = useState<LineDraft[]>(
    initialLines && initialLines.length > 0 ? initialLines : [emptyLine()],
  );

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((line) => line.key !== key) : prev));
  }

  const total = lines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0);

  return (
    <div>
      <input type="hidden" name="linesJson" value={JSON.stringify(lines)} readOnly />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Подразделение</th>
              <th>ЦФО</th>
              <th>Проект</th>
              <th>Продукт/услуга</th>
              <th>Статья ОПиУ</th>
              <th>Сумма *</th>
              <th>в т.ч. НДС</th>
              <th>Описание</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key}>
                <td>
                  <select
                    value={line.departmentId}
                    onChange={(e) => updateLine(line.key, { departmentId: e.target.value })}
                  >
                    <option value="">—</option>
                    {options.departments.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={line.costCenterId}
                    onChange={(e) => updateLine(line.key, { costCenterId: e.target.value })}
                  >
                    <option value="">—</option>
                    {options.costCenters.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={line.projectId}
                    onChange={(e) => updateLine(line.key, { projectId: e.target.value })}
                  >
                    <option value="">—</option>
                    {options.projects.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={line.productServiceId}
                    onChange={(e) => updateLine(line.key, { productServiceId: e.target.value })}
                  >
                    <option value="">—</option>
                    {options.productsServices.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={line.pnlArticleId}
                    onChange={(e) => updateLine(line.key, { pnlArticleId: e.target.value })}
                  >
                    <option value="">—</option>
                    {options.pnlArticles.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    style={{ width: 110 }}
                    value={line.amount}
                    onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    style={{ width: 100 }}
                    value={line.vatAmount}
                    onChange={(e) => updateLine(line.key, { vatAmount: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    style={{ width: 140 }}
                    value={line.description}
                    onChange={(e) => updateLine(line.key, { description: e.target.value })}
                  />
                </td>
                <td>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeLine(line.key)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setLines((prev) => [...prev, emptyLine()])}>
          + Добавить строку
        </button>
        <span className="mono" style={{ fontWeight: 700 }}>
          Итого: {total.toLocaleString("ru-RU", { minimumFractionDigits: 2 })}
        </span>
      </div>
    </div>
  );
}
