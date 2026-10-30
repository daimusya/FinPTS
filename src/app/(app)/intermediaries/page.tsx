import Link from "next/link";
import Decimal from "decimal.js";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getAccessScope } from "@/lib/access-scope";
import { formatMoney } from "@/lib/money";
import { singleParams } from "@/lib/query-params";
import { canExportReport } from "@/lib/reports/export-access";
import { SubmitButton } from "@/components/submit-button";
import { ClientBankUpload } from "@/components/client-bank-upload";
import { organizationsForNewAccounts } from "@/lib/bank-import/client-bank-import";
import { defaultMonth, loadCommissionDashboard, monthParam, parseMonthParam, shiftMonth } from "@/lib/intermediaries/load";
import { hasRateOn, monthLabel, rateOn, type IntermediaryInfo, type IntermediaryMonth, type PayerGroup } from "@/lib/intermediaries/commissions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { addClientAction, bindPayerAction, confirmAllMatchesAction } from "./actions";
import { IntermediaryListUpload } from "./forms";
import { CommissionTrend } from "./trend";

const pctText = (pct: Decimal | null) => (pct === null ? "не задана" : `${pct.toString().replace(".", ",")}%`);
const day = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");

export default async function IntermediariesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const canManage = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const canExport = canExportReport(session.permissions, "intermediaries");
  const [{ context, current, trend }, organizations] = await Promise.all([
    loadCommissionDashboard(scope, ym),
    canManage ? organizationsForNewAccounts(session) : Promise.resolve([]),
  ]);
  const month = monthParam(ym);
  const returnTo = `/intermediaries?month=${month}`;
  const names = new Map(context.intermediaries.map((m) => [m.id, m.name]));
  const monthEnd = new Date(Date.UTC(ym.year, ym.month, 0));
  const rows = current.rows.filter((r) => r.inflows.length > 0 || !hasRateOn(r.intermediary, monthEnd));
  const idle = current.rows.filter((r) => r.inflows.length === 0 && hasRateOn(r.intermediary, monthEnd));
  const payments = current.rows.reduce((n, r) => n + r.inflows.length, 0);
  // «Стандарт» before its turnover start pays nothing by design — not a missing rate.
  const missingPct = current.rows.filter((r) => r.intermediary.category === "VIP" && r.parts.some((p) => p.pct === null));

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Комиссии посредников</h1>
          <p>
            Поступления из загруженных выписок относятся к посредникам по списку их организаций; комиссия — процент от
            поступлений за месяц.
          </p>
        </div>
        <div className="month-nav">
          <Link className="btn btn-ghost btn-sm" href={`/intermediaries?month=${monthParam(shiftMonth(ym, -1))}`} aria-label="Предыдущий месяц">
            ←
          </Link>
          <form className="month-nav__form">
            <input type="month" name="month" defaultValue={month} aria-label="Месяц" />
            <button type="submit" className="btn btn-secondary btn-sm">
              Показать
            </button>
          </form>
          <Link className="btn btn-ghost btn-sm" href={`/intermediaries?month=${monthParam(shiftMonth(ym, 1))}`} aria-label="Следующий месяц">
            →
          </Link>
        </div>
      </div>

      {canManage ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 className="section-title">Загрузить выписку Альфа-Банка</h2>
          <ClientBankUpload organizations={organizations} />
        </div>
      ) : null}

      {context.intermediaries.length === 0 ? (
        <div className="card">
          <h2 className="section-title">Посредники ещё не заведены</h2>
          <p className="text-muted" style={{ marginBottom: 12 }}>
            Загрузите документ Word со списком посредников — или добавьте их по одному.
          </p>
          {canManage ? (
            <>
              <IntermediaryListUpload />
              <div className="form-actions">
                <Link href="/intermediaries/new" className="btn btn-ghost">
                  Добавить посредника вручную
                </Link>
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Поступления через посредников</div>
              <div className="stat-value">{formatMoney(current.totalInflow)}</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                {monthLabel(ym.year, ym.month)} · оплат: {payments}
              </div>
            </div>
            <div className="stat-card stat-card--accent">
              <div className="stat-label">Комиссия к выплате</div>
              <div className="stat-value">{formatMoney(current.totalCommission)}</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                {missingPct.length ? `без ставки: ${missingPct.map((r) => r.intermediary.name).join(", ")}` : "по всем посредникам"}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Проверить плательщиков</div>
              <div className="stat-value">{current.toReview.length + current.ambiguous.length}</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                найдены по названию, ИНН не закреплён
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Без посредника</div>
              <div className="stat-value">{current.unassigned.length}</div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                плательщиков на {formatMoney(current.unassigned.reduce((s, g) => s.plus(g.total), new Decimal(0)))}
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-head">
              <h2 className="section-title">Комиссия по месяцам</h2>
              <span className="text-muted" style={{ fontSize: 12 }}>
                нажмите на месяц, чтобы открыть его
              </span>
            </div>
            <CommissionTrend
              points={trend.map((t) => ({
                month: monthParam(t.ym),
                label: monthLabel(t.ym.year, t.ym.month),
                commission: t.data.totalCommission.toNumber(),
                inflow: t.data.totalInflow.toNumber(),
              }))}
              selected={month}
            />
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="section-head">
              <h2 className="section-title">Посредники · {monthLabel(ym.year, ym.month)}</h2>
              <div className="row-actions">
                <Link href={`/intermediaries/report?month=${month}&id=all`} className="btn btn-primary btn-sm">
                  Печать всех отчётов
                </Link>
                {canExport ? (
                  <a href={`/api/intermediaries/export?month=${month}&id=all`} className="btn btn-secondary btn-sm">
                    Excel: все
                  </a>
                ) : null}
                {canManage ? (
                  <Link href="/intermediaries/new" className="btn btn-ghost btn-sm">
                    + Посредник
                  </Link>
                ) : null}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Посредник</th>
                    <th>Ставка</th>
                    <th style={{ textAlign: "right" }}>Оплат</th>
                    <th style={{ textAlign: "right" }}>Поступления</th>
                    <th style={{ textAlign: "right" }}>Комиссия</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.intermediary.id}>
                      <td>
                        <details className="intermediary-details">
                          <summary>
                            <b>{r.intermediary.name}</b>
                            {r.unconfirmed ? <span className="badge badge-warning" style={{ marginLeft: 8 }}>проверить: {r.unconfirmed}</span> : null}
                          </summary>
                          {r.inflows.length ? (
                            <table className="nested-table">
                              <tbody>
                                {r.inflows.map((op) => (
                                  <tr key={op.id}>
                                    <td className="mono">{day(op.date)}</td>
                                    <td>
                                      {op.payerName}
                                      <div className="text-muted" style={{ fontSize: 12 }}>
                                        ИНН {op.payerInn ?? "—"}
                                        {op.confirmed ? " · закреплён" : ` · по названию «${op.clientName}»`}
                                      </div>
                                    </td>
                                    <td className="mono" style={{ textAlign: "right" }}>
                                      {formatMoney(op.amount)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-muted" style={{ padding: "8px 0" }}>
                              Поступлений за месяц нет.
                            </p>
                          )}
                        </details>
                      </td>
                      <td>
                        <RateCell row={r} monthEnd={monthEnd} />
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {r.inflows.length}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {formatMoney(r.total)}
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                        {r.commission ? formatMoney(r.commission) : "—"}
                      </td>
                      <td>
                        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
                          {r.inflows.length ? (
                            <Link href={`/intermediaries/report?month=${month}&id=${r.intermediary.id}`} className="btn btn-secondary btn-sm">
                              Отчёт
                            </Link>
                          ) : null}
                          {r.inflows.length && canExport ? (
                            <a href={`/api/intermediaries/export?month=${month}&id=${r.intermediary.id}`} className="btn btn-ghost btn-sm">
                              Excel
                            </a>
                          ) : null}
                          <Link href={`/intermediaries/${r.intermediary.id}`} className="btn btn-ghost btn-sm">
                            Настроить
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td>Итого</td>
                    <td />
                    <td className="mono" style={{ textAlign: "right" }}>
                      {payments}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {formatMoney(current.totalInflow)}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {formatMoney(current.totalCommission)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {idle.length ? (
              <p className="text-muted" style={{ marginTop: 10, fontSize: 12 }}>
                Без поступлений в этом месяце:{" "}
                {idle.map((r, i) => (
                  <span key={r.intermediary.id}>
                    {i ? ", " : ""}
                    <Link href={`/intermediaries/${r.intermediary.id}`}>{r.intermediary.name}</Link>
                  </span>
                ))}
              </p>
            ) : null}
          </div>

          {current.toReview.length || current.ambiguous.length ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="section-head">
                <h2 className="section-title">Проверить: найдены по названию</h2>
                {canManage && current.toReview.length > 1 ? (
                  <form action={confirmAllMatchesAction}>
                    <input type="hidden" name="month" value={month} />
                    <input type="hidden" name="returnTo" value={returnTo} />
                    <ConfirmSubmitButton
                      className="btn btn-secondary btn-sm"
                      message={`Закрепить ИНН всех ${current.toReview.length} плательщиков за найденными посредниками?`}
                    >
                      Всё верно — закрепить все ({current.toReview.length})
                    </ConfirmSubmitButton>
                  </form>
                ) : null}
              </div>
              <p className="text-muted" style={{ marginBottom: 10 }}>
                Эти плательщики уже учтены в комиссии по совпадению названия со списком. «Верно» закрепляет ИНН за
                посредником; «не относится к посредникам» — убирает плательщика из всех отчётов.
              </p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Плательщик</th>
                      <th>Найден у посредника</th>
                      <th style={{ textAlign: "right" }}>Сумма за месяц</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...current.ambiguous, ...current.toReview].map((g) => (
                      <tr key={g.key}>
                        <PayerCell group={g} />
                        <td>
                          {g.match.kind === "name" ? (
                            <>
                              <b>{names.get(g.match.intermediaryId)}</b>
                              <div className="text-muted" style={{ fontSize: 12 }}>
                                в списке: «{g.match.clientName}»
                              </div>
                            </>
                          ) : g.match.kind === "ambiguous" ? (
                            <>
                              <span className="badge badge-warning">у нескольких</span>{" "}
                              {g.match.intermediaryIds.map((id) => names.get(id)).join(", ")}
                              <div className="text-muted" style={{ fontSize: 12 }}>
                                в списках: {g.match.clientNames.map((n) => `«${n}»`).join(", ")}
                              </div>
                            </>
                          ) : null}
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {formatMoney(g.total)}
                        </td>
                        <td>{canManage ? <BindControls group={g} intermediaries={context.intermediaries} returnTo={returnTo} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="card">
            <h2 className="section-title">Поступления без посредника</h2>
            <p className="text-muted" style={{ marginBottom: 10 }}>
              Плательщики месяца, которых нет в списках посредников. Если оплата пришла через посредника — отнесите
              плательщика к нему: ИНН закрепится, и его поступления попадут в отчёт за этот и следующие месяцы.
            </p>
            {current.unassigned.length === 0 ? (
              <p className="empty-state">Все поступления месяца разобраны.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Плательщик</th>
                      <th style={{ textAlign: "right" }}>Оплат</th>
                      <th style={{ textAlign: "right" }}>Сумма за месяц</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {current.unassigned.map((g) => (
                      <tr key={g.key}>
                        <PayerCell group={g} />
                        <td className="mono" style={{ textAlign: "right" }}>
                          {g.count}
                        </td>
                        <td className="mono" style={{ textAlign: "right" }}>
                          {formatMoney(g.total)}
                        </td>
                        <td>{canManage ? <BindControls group={g} intermediaries={context.intermediaries} returnTo={returnTo} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {canManage ? (
            <div className="card">
              <h2 className="section-title">Обновить список посредников</h2>
              <p className="text-muted" style={{ marginBottom: 10 }}>
                Новые посредники и организации из документа добавятся, проценты обновятся; ничего не удаляется.
              </p>
              <IntermediaryListUpload />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Ставка месяца; если менялась внутри месяца — все с датой смены. «Стандарт» помечен. */
function RateCell({ row, monthEnd }: { row: IntermediaryMonth; monthEnd: Date }) {
  const standard = row.intermediary.category === "STANDARD";
  const note = standard ? <div className="text-muted" style={{ fontSize: 12 }}>стандарт, по обороту</div> : null;
  if (row.parts.length > 1) {
    return (
      <>
        {row.parts.map((p) => (p.pct === null ? (standard ? "без комиссии" : "не задана") : pctText(p.pct))).join(" → ")}
        <div className="text-muted" style={{ fontSize: 12 }}>
          {row.parts.slice(1).map((p) => `с ${day(p.from)}`).join(", ")}
        </div>
        {note}
      </>
    );
  }
  if (standard && row.parts.length === 0) return <span className="text-muted">стандарт, по обороту</span>;
  const pct = row.parts.length ? row.parts[0].pct : rateOn(row.intermediary, monthEnd);
  if (pct === null && standard) return <span className="text-muted">до начала оборота</span>;
  return pct === null ? (
    <span className="badge badge-danger">не задана</span>
  ) : (
    <>
      {pctText(pct)}
      {note}
    </>
  );
}

function PayerCell({ group }: { group: PayerGroup }) {
  return (
    <td>
      {group.name}
      <div className="text-muted" style={{ fontSize: 12 }}>
        ИНН {group.inn ?? "не указан"}
      </div>
    </td>
  );
}

/** Отнести плательщика: по ИНН (закрепление), без ИНН — его наименование добавляется в список посредника. */
function BindControls({ group, intermediaries, returnTo }: { group: PayerGroup; intermediaries: IntermediaryInfo[]; returnTo: string }) {
  const suggested = group.match.kind === "name" ? group.match.intermediaryId : "";
  if (!group.inn) {
    return (
      <form action={addClientAction} className="bind-form">
        <input type="hidden" name="name" value={group.name} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <select name="intermediaryId" defaultValue={suggested} required aria-label="Посредник">
          <option value="">— посредник —</option>
          {intermediaries.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <SubmitButton className="btn btn-secondary btn-sm">В список</SubmitButton>
      </form>
    );
  }
  return (
    <div className="bind-form">
      {suggested ? (
        <form action={bindPayerAction}>
          <input type="hidden" name="inn" value={group.inn} />
          <input type="hidden" name="payerName" value={group.name} />
          <input type="hidden" name="intermediaryId" value={suggested} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <SubmitButton className="btn btn-primary btn-sm">Верно</SubmitButton>
        </form>
      ) : null}
      <form action={bindPayerAction} className="bind-form">
        <input type="hidden" name="inn" value={group.inn} />
        <input type="hidden" name="payerName" value={group.name} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <select name="intermediaryId" defaultValue="" required aria-label="Посредник">
          <option value="">{suggested ? "— другой —" : "— посредник —"}</option>
          {intermediaries
            .filter((m) => m.id !== suggested)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          <option value="none">не относится к посредникам</option>
        </select>
        <SubmitButton className="btn btn-secondary btn-sm">Отнести</SubmitButton>
      </form>
    </div>
  );
}
