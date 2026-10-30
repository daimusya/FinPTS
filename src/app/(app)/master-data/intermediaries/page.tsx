import Link from "next/link";
import Decimal from "decimal.js";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { getAccessScope } from "@/lib/access-scope";
import { formatMoney } from "@/lib/money";
import { singleParams } from "@/lib/query-params";
import { loadCommissionPeriod, loadPriorTurnover } from "@/lib/intermediaries/load";
import { scalePct, scaleSummary } from "@/lib/intermediaries/standard-scale";
import { StandardScaleForm } from "../../intermediaries/forms";
import { rateOn } from "@/lib/intermediaries/commissions";
import { parsePeriod, periodEndExclusive, periodLabel, periodQuery } from "@/lib/intermediaries/period";
import { PeriodFilter, periodHref } from "../../intermediaries/period-filter";

const day = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
const pctText = (pct: { toString(): string } | null) => (pct === null ? "не задана" : `${pct.toString().replace(".", ",")}%`);

/** Справочник посредников: категории и ставки, списки организаций, поступления за любой период, шкала «Стандарта». */
export default async function IntermediariesDirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра посредников.</div>
      </div>
    );
  }
  const sp = singleParams(await searchParams);
  const period = parsePeriod(sp);
  const showArchived = sp.archived === "1";
  const canManage = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const [list, { context, period: data }] = await Promise.all([
    prisma.intermediary.findMany({
      where: showArchived ? {} : { isArchived: false },
      orderBy: [{ isArchived: "asc" }, { name: "asc" }],
      include: {
        rates: { select: { validFrom: true, commissionPct: true }, orderBy: { validFrom: "asc" } },
        _count: { select: { clients: true, payers: true } },
      },
    }),
    loadCommissionPeriod(await getAccessScope(session), period.from, periodEndExclusive(period)),
  ]);
  const rows = new Map(data.rows.map((r) => [r.intermediary.id, r]));
  const today = new Date();
  const turnoverNow = await loadPriorTurnover(context, new Date(today.getTime() + 24 * 3600_000));
  const payments = data.rows.reduce((n, r) => n + r.inflows.length, 0);
  const unassignedTotal = data.unassigned.reduce((s, g) => s.plus(g.total), new Decimal(0));
  const toReview = data.toReview.length + data.ambiguous.length;
  const archivedToggle = new URLSearchParams({ ...periodQuery(period), ...(showArchived ? {} : { archived: "1" }) }).toString();

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Посредники</h1>
          <p>
            ВИП — ставка по согласованию; Стандарт — по шкале от оборота накопительным итогом ({scaleSummary(context.scale)}).
            Поступления через посредников — за любой период.
          </p>
        </div>
        <div className="row-actions">
          <Link href="/intermediaries" className="btn btn-ghost">
            Комиссии по месяцам
          </Link>
          {canManage ? (
            <Link href="/intermediaries/new" className="btn btn-primary">
              + Посредник
            </Link>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2 className="section-title">Поступления · {periodLabel(period)}</h2>
          <Link href={`/master-data/intermediaries?${archivedToggle}`} className="btn btn-ghost btn-sm">
            {showArchived ? "Скрыть архивных" : "Показать архивных"}
          </Link>
        </div>
        <PeriodFilter path="/master-data/intermediaries" period={period} extra={showArchived ? { archived: "1" } : {}} />

        {list.length === 0 ? (
          <p className="empty-state">
            Посредников пока нет. <Link href="/intermediaries">Загрузите список из Word</Link> или добавьте по одному.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Посредник</th>
                  <th>Категория</th>
                  <th>Ставка сейчас</th>
                  <th style={{ textAlign: "right" }}>Организаций</th>
                  <th style={{ textAlign: "right" }}>ИНН закреплено</th>
                  <th style={{ textAlign: "right" }}>Оплат</th>
                  <th style={{ textAlign: "right" }}>Поступления</th>
                  <th style={{ textAlign: "right" }}>Комиссия</th>
                </tr>
              </thead>
              <tbody>
                {list.map((m) => {
                  const row = rows.get(m.id);
                  const rateInfo = {
                    commissionPct: m.commissionPct === null ? null : new Decimal(m.commissionPct.toString()),
                    rateChanges: m.rates.map((r) => ({ from: r.validFrom, pct: new Decimal(r.commissionPct.toString()) })),
                  };
                  const lastChange = m.rates.filter((r) => r.validFrom <= today).at(-1);
                  const nextChange = m.rates.find((r) => r.validFrom > today);
                  const standard = m.category === "STANDARD";
                  const accumulated = turnoverNow.get(m.id) ?? new Decimal(0);
                  const current = standard ? scalePct(context.scale, accumulated) : rateOn(rateInfo, today);
                  return (
                    <tr key={m.id}>
                      <td>
                        <Link href={periodHref(`/intermediaries/${m.id}`, period, "operations")}>
                          <b>{m.name}</b>
                        </Link>
                        {m.isArchived ? <span className="badge badge-archived" style={{ marginLeft: 8 }}>в архиве</span> : null}
                        {m.reportName ? (
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            в отчёте: {m.reportName}
                          </div>
                        ) : null}
                      </td>
                      <td>{standard ? "Стандарт" : <span className="badge badge-orange">ВИП</span>}</td>
                      <td>
                        {current === null ? <span className="badge badge-danger">не задана</span> : pctText(current)}
                        {standard ? (
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            накоплено {formatMoney(accumulated)}
                            {m.turnoverFrom ? ` с ${day(m.turnoverFrom)}` : ""}
                          </div>
                        ) : lastChange || nextChange ? (
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            {lastChange ? `с ${day(lastChange.validFrom)}` : ""}
                            {nextChange ? `${lastChange ? "; " : ""}с ${day(nextChange.validFrom)} — ${pctText(nextChange.commissionPct)}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {m._count.clients}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {m._count.payers}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {row ? row.inflows.length : "—"}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {row ? formatMoney(row.total) : "—"}
                      </td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 700 }}>
                        {row?.commission ? formatMoney(row.commission) : "—"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="total-row">
                  <td colSpan={5}>Итого</td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {payments}
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {formatMoney(data.totalInflow)}
                  </td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {formatMoney(data.totalCommission)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {data.unassigned.length || toReview ? (
          <p className="text-muted" style={{ marginTop: 10, fontSize: 12 }}>
            {toReview ? `Найдены по названию и ждут проверки: ${toReview} плательщиков. ` : ""}
            {data.unassigned.length ? `Без посредника: ${data.unassigned.length} плательщиков на ${formatMoney(unassignedTotal)}. ` : ""}
            Разобрать их можно на странице <Link href="/intermediaries">«Комиссии посредников»</Link> по месяцам.
          </p>
        ) : null}
      </div>

      <div className="card" id="scale">
        <h2 className="section-title">Шкала «Стандарт»</h2>
        <p className="text-muted" style={{ marginBottom: 10 }}>
          Ставка зависит от оборота посредника накопительным итогом с даты в его карточке. Каждая оплата целиком идёт по ступени, в
          которую попал накопленный оборот вместе с ней; прошлые оплаты при переходе порога не пересчитываются.
        </p>
        {canManage ? (
          <StandardScaleForm tiers={context.scale.map((t) => ({ upTo: t.upTo?.toString() ?? "", pct: t.pct.toString() }))} />
        ) : (
          <p>{scaleSummary(context.scale)}</p>
        )}
      </div>
    </div>
  );
}
