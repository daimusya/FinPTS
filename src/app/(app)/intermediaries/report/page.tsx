import Link from "next/link";
import type Decimal from "decimal.js";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getAccessScope } from "@/lib/access-scope";
import { singleParams } from "@/lib/query-params";
import { canExportReport } from "@/lib/reports/export-access";
import { formatNumber } from "@/lib/money";
import { defaultMonth, monthParam, parseMonthParam } from "@/lib/intermediaries/load";
import { loadIntermediaryReports } from "@/lib/intermediaries/report";
import { PrintButton } from "../forms";

const day = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
const amount = (v: Decimal) => formatNumber(v);

export default async function IntermediaryReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра комиссий посредников.</div>
      </div>
    );
  }
  const sp = singleParams(await searchParams);
  const scope = await getAccessScope(session);
  const ym = parseMonthParam(sp.month) ?? (await defaultMonth(scope));
  const id = sp.id || "all";
  const reports = await loadIntermediaryReports(scope, ym, id);
  const month = monthParam(ym);

  return (
    <div className="page">
      <div className="page-header no-print">
        <div>
          <h1>{id === "all" ? "Отчёты посредников" : "Отчёт посредника"}</h1>
          <p>Каждый посредник печатается на отдельном листе A4.</p>
        </div>
        <div className="row-actions">
          <PrintButton />
          {canExportReport(session.permissions, "intermediaries") && reports.length ? (
            <a href={`/api/intermediaries/export?month=${month}&id=${id}`} className="btn btn-secondary">
              Excel
            </a>
          ) : null}
          <Link href={`/intermediaries?month=${month}`} className="btn btn-ghost">
            К дашборду
          </Link>
        </div>
      </div>

      {reports.length === 0 ? <div className="card">За этот месяц поступлений через посредников нет.</div> : null}

      {reports.map((r) => (
        <section key={r.id} className="print-report">
          <h2>{r.title}</h2>
          <div className="print-report__article">{r.article}</div>
          <table>
            <colgroup>
              <col style={{ width: "16%" }} />
              <col style={{ width: "62%" }} />
              <col style={{ width: "22%" }} />
            </colgroup>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Содержание операции</th>
                <th>Поступления</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((line, i) => (
                <tr key={i}>
                  <td style={{ textAlign: "center" }}>{day(line.date)}</td>
                  <td>{line.text}</td>
                  <td className="num">{amount(line.amount)}</td>
                </tr>
              ))}
              <tr className="print-report__total">
                <td colSpan={2}>Итого</td>
                <td className="num">{amount(r.total)}</td>
              </tr>
              {r.commissionLines.map((line, i) => (
                <tr key={`c${i}`} className="print-report__total">
                  <td colSpan={2}>{line.label}</td>
                  <td className="num">{line.amount ? amount(line.amount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
