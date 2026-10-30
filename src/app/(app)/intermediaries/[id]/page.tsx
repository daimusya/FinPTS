import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSession, hasPermission } from "@/lib/session";
import { PERMISSIONS } from "@/lib/permissions";
import { SubmitButton } from "@/components/submit-button";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { addClientAction, addRateChangeAction, archiveIntermediaryAction, bindPayerAction, removeClientAction, removeRateChangeAction } from "../actions";
import { IntermediaryForm } from "../forms";
import { PeriodFilter } from "../period-filter";
import { singleParams } from "@/lib/query-params";
import { getAccessScope } from "@/lib/access-scope";
import { formatMoney } from "@/lib/money";
import { loadCommissionPeriod, loadPriorTurnover } from "@/lib/intermediaries/load";
import { scalePct, tierLabel } from "@/lib/intermediaries/standard-scale";
import { BEFORE_TURNOVER, rateOn } from "@/lib/intermediaries/commissions";
import { parsePeriod, periodEndExclusive, periodLabel } from "@/lib/intermediaries/period";

const day = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");
const pctText = (pct: { toString(): string } | null) => (pct === null ? "не задана" : `${pct.toString().replace(".", ",")}%`);
/** Больше строк на странице не показываем — для длинного периода сузьте даты. */
const MAX_ROWS = 1000;

export default async function IntermediaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session, PERMISSIONS.CASH_VIEW)) {
    return (
      <div className="page">
        <div className="card">Недостаточно прав для просмотра комиссий посредников.</div>
      </div>
    );
  }
  const { id } = await params;
  const sp = singleParams(await searchParams);
  const intermediary = await prisma.intermediary.findUnique({
    where: { id },
    include: {
      clients: { orderBy: { name: "asc" } },
      payers: { orderBy: { payerName: "asc" } },
      rates: { orderBy: { validFrom: "asc" } },
    },
  });
  if (!intermediary) notFound();
  const canManage = hasPermission(session, PERMISSIONS.CASH_MANAGE);
  const returnTo = `/intermediaries/${id}`;
  const period = parsePeriod(sp);
  const { context, period: data } = await loadCommissionPeriod(await getAccessScope(session), period.from, periodEndExclusive(period));
  const row = data.rows.find((r) => r.intermediary.id === id);
  const today = new Date();
  const standard = intermediary.category === "STANDARD";
  const turnoverNow = standard && row ? ((await loadPriorTurnover(context, new Date(today.getTime() + 24 * 3600_000))).get(id) ?? null) : null;
  const currentRate = standard ? (turnoverNow ? scalePct(context.scale, turnoverNow) : context.scale[0].pct) : row ? rateOn(row.intermediary, today) : intermediary.commissionPct;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>
            {intermediary.name}
            {intermediary.isArchived ? <span className="badge badge-archived" style={{ marginLeft: 10 }}>в архиве</span> : null}
          </h1>
          <p>Организации, поступления от которых дают посреднику комиссию.</p>
        </div>
        <div className="row-actions">
          <Link href="/master-data/intermediaries" className="btn btn-ghost">
            К справочнику
          </Link>
          <Link href="/intermediaries" className="btn btn-ghost">
            К дашборду
          </Link>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Посредник и ставка</h2>
        {canManage ? (
          <IntermediaryForm
            intermediary={{
              id: intermediary.id,
              name: intermediary.name,
              reportName: intermediary.reportName,
              commissionPct: intermediary.commissionPct?.toString() ?? null,
              category: intermediary.category,
              turnoverFrom: intermediary.turnoverFrom?.toISOString().slice(0, 10) ?? "",
            }}
            firstRateChange={intermediary.rates.length ? day(intermediary.rates[0].validFrom) : undefined}
          />
        ) : (
          <p>
            {standard ? "Категория «Стандарт», ставка по шкале сейчас" : "Категория ВИП, комиссия сейчас"}: {pctText(currentRate)}; в отчёте —{" "}
            {intermediary.reportName || intermediary.name}.
          </p>
        )}
      </div>

      {standard ? (
        <div className="card" id="rates">
          <h2 className="section-title">Ставка по шкале «Стандарт»</h2>
          <p className="text-muted" style={{ marginBottom: 10 }}>
            Оборот копится {intermediary.turnoverFrom ? `с ${day(intermediary.turnoverFrom)}` : "с первой оплаты"}. Каждая оплата целиком
            идёт по ступени, в которую попал накопленный оборот вместе с ней; прошлые оплаты при переходе порога не пересчитываются.
          </p>
          <div className="table-wrap" style={{ marginBottom: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Накопленный оборот</th>
                  <th style={{ textAlign: "right" }}>Ставка</th>
                </tr>
              </thead>
              <tbody>
                {context.scale.map((tier, i) => (
                  <tr key={i}>
                    <td>
                      {tierLabel(context.scale, i)}
                      {tier.pct.equals(currentRate ?? -1) ? <span className="badge badge-active" style={{ marginLeft: 8 }}>сейчас</span> : null}
                    </td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {pctText(tier.pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 13 }}>
            Накоплено на сегодня: <b>{formatMoney(turnoverNow ?? 0)}</b>.{" "}
            <Link href="/master-data/intermediaries#scale">Изменить шкалу</Link> (общая для всех посредников «Стандарт»).
          </p>
        </div>
      ) : (
        <div className="card" id="rates">
          <h2 className="section-title">Ставка комиссии по датам</h2>
          <p className="text-muted" style={{ marginBottom: 10 }}>
            Каждое поступление считается по ставке, действовавшей на дату оплаты. Новая ставка действует с указанного дня до
            следующего изменения; отчёты за прошлые месяцы пересчитываются, если дата попадает в них.
          </p>
          {sp.rateError ? <p className="form-error" style={{ marginBottom: 10 }}>{sp.rateError}</p> : null}
          <div className="table-wrap" style={{ marginBottom: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>Действует</th>
                  <th style={{ textAlign: "right" }}>Ставка</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{intermediary.rates.length ? `до ${day(new Date(intermediary.rates[0].validFrom.getTime() - 24 * 3600_000))} включительно` : "всё время"}</td>
                  <td className="mono" style={{ textAlign: "right" }}>
                    {pctText(intermediary.commissionPct)}
                  </td>
                  <td className="text-muted" style={{ fontSize: 12 }}>
                    начальная — меняется в форме выше
                  </td>
                </tr>
                {intermediary.rates.map((r, i) => {
                  const next = intermediary.rates[i + 1];
                  return (
                    <tr key={r.id}>
                      <td>
                        с {day(r.validFrom)}
                        {next ? ` по ${day(new Date(next.validFrom.getTime() - 24 * 3600_000))}` : ""}
                        {!next && r.validFrom <= today ? <span className="badge badge-active" style={{ marginLeft: 8 }}>действует</span> : null}
                        {r.validFrom > today ? <span className="badge badge-warning" style={{ marginLeft: 8 }}>с будущей даты</span> : null}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {pctText(r.commissionPct)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {canManage ? (
                          <form action={removeRateChangeAction}>
                            <input type="hidden" name="rateId" value={r.id} />
                            <ConfirmSubmitButton
                              className="btn btn-ghost btn-sm"
                              message={`Удалить ставку ${pctText(r.commissionPct)} с ${day(r.validFrom)}? Поступления с этой даты будут считаться по предыдущей ставке.`}
                            >
                              Удалить
                            </ConfirmSubmitButton>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canManage ? (
            <form action={addRateChangeAction} className="client-bank-form">
              <input type="hidden" name="intermediaryId" value={intermediary.id} />
              <label className="field">
                <span>Новая ставка с даты</span>
                <input type="date" name="validFrom" id="rate-valid-from" required />
              </label>
              <label className="field">
                <span>Ставка, %</span>
                <input name="commissionPct" id="rate-pct" inputMode="decimal" required placeholder="15" />
              </label>
              <ConfirmSubmitButton
                className="btn btn-secondary"
                message="Поступления с этой даты будут считаться по новой ставке — в том числе в отчётах за прошедшие месяцы. Сохранить?"
              >
                Изменить ставку
              </ConfirmSubmitButton>
            </form>
          ) : null}
        </div>
      )}

      <div className="card" id="operations">
        <h2 className="section-title">Поступления · {periodLabel(period)}</h2>
        <PeriodFilter path={returnTo} period={period} anchor="operations" />
        {!row ? (
          <p className="empty-state">Посредник в архиве — его поступления не относятся к нему и не попадают в отчёты.</p>
        ) : row.inflows.length === 0 ? (
          <p className="empty-state">За этот период поступлений нет.</p>
        ) : (
          <>
            <div className="stat-grid">
              <div className="stat-card">
                <div className="stat-label">Поступления</div>
                <div className="stat-value">{formatMoney(row.total)}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  оплат: {row.inflows.length}
                  {row.unconfirmed ? ` · по названию: ${row.unconfirmed}` : ""}
                </div>
              </div>
              <div className="stat-card stat-card--accent">
                <div className="stat-label">Комиссия за период</div>
                <div className="stat-value">{row.commission ? formatMoney(row.commission) : "—"}</div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {row.parts.map((p) => `${p.basis === BEFORE_TURNOVER ? BEFORE_TURNOVER : pctText(p.pct)} от ${formatMoney(p.total)}`).join("; ")}
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Плательщик</th>
                    <th>Назначение платежа</th>
                    <th style={{ textAlign: "right" }}>Ставка</th>
                    <th style={{ textAlign: "right" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {row.inflows.slice(0, MAX_ROWS).map((op) => (
                    <tr key={op.id}>
                      <td className="mono">
                        <Link href={`/cash/transactions/${op.id}`}>{day(op.date)}</Link>
                      </td>
                      <td>
                        {op.payerName ?? "без наименования"}
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          ИНН {op.payerInn ?? "—"}
                          {op.confirmed ? " · закреплён" : ` · по названию «${op.clientName}»`}
                        </div>
                      </td>
                      <td className="text-muted" style={{ fontSize: 12, maxWidth: 360 }}>
                        {op.purpose ?? ""}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {op.appliedPct === null && standard ? "—" : pctText(op.appliedPct ?? null)}
                      </td>
                      <td className="mono" style={{ textAlign: "right" }}>
                        {formatMoney(op.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={4}>Итого</td>
                    <td className="mono" style={{ textAlign: "right" }}>
                      {formatMoney(row.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            {row.inflows.length > MAX_ROWS ? (
              <p className="text-muted" style={{ marginTop: 10, fontSize: 12 }}>
                Показаны первые {MAX_ROWS} из {row.inflows.length} оплат; итоги и комиссия — по всем. Сузьте период, чтобы увидеть остальные.
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">Организации из списка · {intermediary.clients.length}</h2>
        <p className="text-muted" style={{ marginBottom: 10 }}>
          Поиск в выписке — по названию без учёта ООО/ИП/СЗ, кавычек и регистра; для ИП — по фамилии и инициалам.
          Одноимённые организации различаются окончанием ИНН в названии: «ООО ПСК инн 105».
        </p>
        {canManage ? (
          <form action={addClientAction} className="client-bank-form" style={{ marginBottom: 12 }}>
            <input type="hidden" name="intermediaryId" value={intermediary.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <label className="field" style={{ flex: "1 1 280px" }}>
              <span>Добавить организацию</span>
              <input name="name" required placeholder="ООО Ромашка" />
            </label>
            <SubmitButton className="btn btn-secondary">Добавить</SubmitButton>
          </form>
        ) : null}
        <ul className="tag-list client-list">
          {intermediary.clients.map((c) => (
            <li key={c.id}>
              {c.name}
              {canManage ? (
                <form action={removeClientAction}>
                  <input type="hidden" name="clientId" value={c.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <button type="submit" className="client-list__remove" aria-label={`Убрать ${c.name}`} title="Убрать из списка">
                    ×
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="section-title">Закреплённые плательщики (по ИНН) · {intermediary.payers.length}</h2>
        <p className="text-muted" style={{ marginBottom: 10 }}>
          Закрепляются на дашборде кнопками «Верно» и «Отнести». Закреплённый ИНН важнее совпадения названия.
        </p>
        {intermediary.payers.length === 0 ? (
          <p className="empty-state">Пока нет.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Плательщик</th>
                  <th>ИНН</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {intermediary.payers.map((p) => (
                  <tr key={p.inn}>
                    <td>{p.payerName ?? "—"}</td>
                    <td className="mono">{p.inn}</td>
                    <td style={{ textAlign: "right" }}>
                      {canManage ? (
                        <form action={bindPayerAction}>
                          <input type="hidden" name="inn" value={p.inn} />
                          <input type="hidden" name="intermediaryId" value="" />
                          <input type="hidden" name="returnTo" value={returnTo} />
                          <SubmitButton className="btn btn-ghost btn-sm">Открепить</SubmitButton>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage ? (
        <div className="card">
          <form action={archiveIntermediaryAction}>
            <input type="hidden" name="id" value={intermediary.id} />
            <input type="hidden" name="archive" value={intermediary.isArchived ? "0" : "1"} />
            {intermediary.isArchived ? (
              <SubmitButton className="btn btn-secondary">Вернуть из архива</SubmitButton>
            ) : (
              <ConfirmSubmitButton message={`Убрать посредника «${intermediary.name}» в архив? Его поступления перестанут попадать в отчёты.`} className="btn btn-danger">
                В архив
              </ConfirmSubmitButton>
            )}
          </form>
        </div>
      ) : null}
    </div>
  );
}
