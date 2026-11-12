import Link from "next/link";
import type Decimal from "decimal.js";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getAccessScope, isScopeRestricted } from "@/lib/access-scope";
import { singleParams } from "@/lib/query-params";
import { canExportReport } from "@/lib/reports/export-access";
import { formatNumber } from "@/lib/money";
import { defaultMonth, monthParam, parseMonthParam } from "@/lib/intermediaries/load";
import { calculateCommissionCorrection, commissionReportColumns, commissionReportFingerprint, commissionReportVersionNotes, formatCommissionFixedDate, loadCommissionVersionHistory, loadIntermediaryReports, parseCommissionVersion } from "@/lib/intermediaries/report";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { fixIntermediaryCommissionAction } from "../actions";
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
  const month = monthParam(ym);
  const canFix = hasPermission(session, PERMISSIONS.CASH_MANAGE) && !isScopeRestricted(scope);
  const version = sp.version === undefined ? undefined : parseCommissionVersion(sp.version);
  const [savedReports, history] = await Promise.all([
    version === null ? [] : loadIntermediaryReports(scope, ym, id, version),
    loadCommissionVersionHistory(scope, ym, id),
  ]);
  const latest = version === undefined && id !== "all" ? savedReports[0] : undefined;
  const isCorrection = canFix && sp.correct === "1" && Boolean(latest?.version);
  const draft = isCorrection ? await calculateCommissionCorrection(scope, ym, id) : null;
  const reports = isCorrection ? (draft ? [draft] : []) : savedReports;
  const versionQuery = version ? `&version=${version}` : "";
  const reportUrl = (intermediaryId: string) => `/intermediaries/report?month=${month}&id=${encodeURIComponent(intermediaryId)}`;

  return (
    <div className="page">
      <div className="page-header no-print">
        <div>
          <h1>{id === "all" ? "Отчёты посредников" : "Отчёт посредника"}</h1>
          <p>Каждый посредник печатается на отдельном листе A4.</p>
        </div>
        <div className="row-actions">
          {!isCorrection ? <PrintButton /> : null}
          {!isCorrection && canExportReport(session.permissions, "intermediaries") && reports.length ? (
            <a href={`/api/intermediaries/export?month=${month}&id=${encodeURIComponent(id)}${versionQuery}`} className="btn btn-secondary">
              Excel
            </a>
          ) : null}
          <Link href={`/intermediaries?month=${month}`} className="btn btn-ghost">
            К дашборду
          </Link>
        </div>
      </div>

      {reports.length === 0 ? <div className="card">{isCorrection ? "Текущий расчёт недоступен. Проверьте, что посредник активен." : version !== undefined ? "Версия отчёта недоступна." : "За этот месяц поступлений через посредников нет."}</div> : null}
      {sp.fixChanged === "1" ? <p className="no-print" role="alert">Расчёт изменился. Проверьте обновлённый отчёт перед сохранением.</p> : null}
      {sp.versionChanged === "1" ? <p className="no-print" role="alert">Уже сохранена более новая версия. Проверьте её перед корректировкой.</p> : null}
      {sp.reasonError === "1" ? <p className="no-print" role="alert">Укажите причину корректировки длиной до 1 000 символов.</p> : null}
      {history.length ? (
        <details className="card no-print" open={version !== undefined}>
          <summary>История версий</summary>
          <ul>
            {history.map((item, i) => (
              <li key={item.version}>
                <Link href={`${reportUrl(id)}&version=${item.version}`}>Версия {item.version}</Link>
                {i === 0 ? " · актуальная" : ""} · {formatCommissionFixedDate(item.fixedAt)}
                {item.correctionReason ? <div>Причина корректировки: {item.correctionReason}</div> : null}
              </li>
            ))}
          </ul>
          {version !== undefined || isCorrection ? <Link href={reportUrl(id)}>К актуальной версии</Link> : null}
        </details>
      ) : null}

      {reports.map((r) => (
        <section key={r.id} className="print-report">
          <h2>{r.title}</h2>
          <div className="print-report__article">{r.article}</div>
          {r.fixedAt ? (
            <>
              {commissionReportVersionNotes(r).map((note) => <p key={note}>{note}</p>)}
              {id === "all" ? <Link className="no-print" href={reportUrl(r.id)}>Открыть отчёт и историю версий</Link> : null}
              {canFix && id !== "all" && version === undefined ? (
                <Link className="btn btn-secondary btn-sm no-print" href={`${reportUrl(r.id)}&correct=1`}>Исправить комиссию</Link>
              ) : null}
            </>
          ) : isCorrection && latest?.version ? (
            <div className="no-print">
              <p>Проект версии {latest.version + 1}. Комиссия в версии {latest.version} — {latest.commission ? amount(latest.commission) : "—"} ₽.</p>
              {r.commission !== null ? (
                <form action={fixIntermediaryCommissionAction.bind(null, r.id, month, commissionReportFingerprint(r), false, latest.version)}>
                  <label className="field">
                    <span>Причина корректировки</span>
                    <textarea name="correctionReason" required maxLength={1000} rows={3} />
                  </label>
                  <ConfirmSubmitButton className="btn btn-primary btn-sm" message="Сохранить новую версию комиссии за этот месяц?">
                    Сохранить новую версию
                  </ConfirmSubmitButton>
                </form>
              ) : <p>Для сохранения корректировки задайте ставку комиссии.</p>}
            </div>
          ) : canFix && r.commission && r.lines.length ? (
            <form className="no-print" action={fixIntermediaryCommissionAction.bind(null, r.id, month, commissionReportFingerprint(r), id === "all", 0)}>
              <ConfirmSubmitButton className="btn btn-primary btn-sm" message="Зафиксировать текущие поступления, ставки и комиссию в отчёте за этот месяц?">
                Зафиксировать комиссию
              </ConfirmSubmitButton>
            </form>
          ) : null}
          <table>
            <colgroup>
              <col style={{ width: "16%" }} />
              <col style={{ width: "27%" }} />
              <col style={{ width: "38%" }} />
              <col style={{ width: "19%" }} />
            </colgroup>
            <thead>
              <tr>
                {commissionReportColumns.map((column) => <th key={column}>{column}</th>)}
              </tr>
            </thead>
            <tbody>
              {r.lines.map((line, i) => (
                <tr key={i}>
                  <td style={{ textAlign: "center" }}>{day(line.date)}</td>
                  <td style={{ overflowWrap: "anywhere" }}>{line.counterparty}</td>
                  <td style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{line.purpose}</td>
                  <td className="num">{amount(line.amount)}</td>
                </tr>
              ))}
              <tr className="print-report__total">
                <td colSpan={3}>Итого</td>
                <td className="num">{amount(r.total)}</td>
              </tr>
              {r.commissionLines.map((line, i) => (
                <tr key={`c${i}`} className="print-report__total">
                  <td colSpan={3}>{line.label}</td>
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
