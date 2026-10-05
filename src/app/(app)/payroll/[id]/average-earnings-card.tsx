import { formatMoney, formatNumber, sumMoney } from "@/lib/money";
import { MONTH_NAMES_SHORT } from "@/lib/financial-model/drivers";
import {
  AVERAGE_FIELDS,
  computeAverageEarnings,
  parseAverageRequest,
  type AverageEarningsPreview,
  type AverageParams,
} from "@/lib/payroll/average-earnings-db";
import { AVG_DAYS_PER_MONTH, EMPLOYER_PAID_SICK_DAYS, SICK_LEAVE_DIVISOR } from "@/lib/payroll/average-earnings";
import { addAverageEarningsLineAction } from "../actions";
import { SubmitButton } from "@/components/submit-button";

/**
 * Расчёт отпускных и больничных по среднему заработку: форма параметров
 * (GET — остаётся на странице расчёта), подробная расшифровка и кнопка
 * добавления строки. Сумма в строке пересчитывается на сервере заново.
 */
export async function AverageEarningsCard({
  runId,
  employees,
  params,
}: {
  runId: string;
  employees: Array<{ id: string; fullName: string }>;
  params: AverageParams;
}) {
  const requested = Boolean(params.avgKind);
  let preview: AverageEarningsPreview | null = null;
  let error: string | null = null;
  if (requested) {
    const parsed = parseAverageRequest(params);
    if ("error" in parsed) {
      error = parsed.error;
    } else if (!employees.some((e) => e.id === parsed.request.employeeId)) {
      error = "Сотрудник не из организации этого расчёта";
    } else {
      try {
        preview = await computeAverageEarnings(parsed.request);
      } catch (e) {
        error = (e as Error).message;
      }
    }
  }
  const kind = params.avgKind === "sick" ? "sick" : "vacation";

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Отпускные и больничные по среднему заработку</h2>
      <p className="text-muted" style={{ marginBottom: 12 }}>
        Средний заработок считается по утверждённым и выплаченным расчётам сотрудника. Отпускные — за 12 месяцев до
        месяца начала отпуска (ст. 139 ТК РФ, Положение № 922), дни отпуска, болезни и командировок по табелю
        исключаются; при повышении окладов в организации или подразделении — с индексацией (п. 16). Больничные — за 2
        года до года болезни (ст. 14 Закона № 255-ФЗ) с учётом предельной базы и МРОТ из справочника «Параметры расчёта
        зарплаты» и районного коэффициента организации; страховой стаж — по карточке сотрудника.
      </p>
      <form className="form-grid" style={{ alignItems: "flex-end" }}>
        <label className="field">
          <span>Рассчитать</span>
          <select name="avgKind" defaultValue={kind}>
            <option value="vacation">Отпускные</option>
            <option value="sick">Больничные</option>
          </select>
        </label>
        <label className="field">
          <span>Сотрудник</span>
          <select name="avgEmployeeId" defaultValue={params.avgEmployeeId ?? ""} required>
            <option value="">— выбрать —</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.fullName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Дата начала отпуска / болезни</span>
          <input type="date" name="avgStart" defaultValue={params.avgStart ?? ""} required />
        </label>
        <label className="field">
          <span>Календарных дней</span>
          <input type="number" name="avgDays" min={1} max={366} step={1} defaultValue={params.avgDays ?? ""} required style={{ width: 90 }} />
        </label>
        <label className="field">
          <span>Страховой стаж (для больничных)</span>
          <select name="avgPct" defaultValue={params.avgPct ?? "auto"}>
            <option value="auto">Автоматически — по карточке сотрудника</option>
            <option value="100">8 лет и больше — 100%</option>
            <option value="80">от 5 до 8 лет — 80%</option>
            <option value="60">до 5 лет — 60%</option>
            <option value="short">меньше 6 месяцев — 60%, не больше МРОТ за месяц</option>
          </select>
        </label>
        <label className="field">
          <span>Заработок у других работодателей, за позапрошлый год</span>
          <input type="text" inputMode="decimal" name="avgOther1" defaultValue={params.avgOther1 ?? ""} placeholder="0" style={{ width: 130 }} />
        </label>
        <label className="field">
          <span>…за прошлый год</span>
          <input type="text" inputMode="decimal" name="avgOther2" defaultValue={params.avgOther2 ?? ""} placeholder="0" style={{ width: 130 }} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, gridColumn: "1 / -1" }}>
          <input type="checkbox" name="avgIndex" id="avg-index" defaultChecked={params.avgIndex === "on"} />
          Отпускные: оклады повышены в организации или подразделении — индексировать средний заработок (п. 16 Положения № 922)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" name="avgReplace" id="avg-replace" defaultChecked={params.avgReplace === "on"} />
          Больничные: заменить годы расчётного периода по заявлению сотрудника (был отпуск по беременности и родам или по уходу за ребёнком)
        </label>
        <label className="field">
          <span>Годы расчёта (при замене)</span>
          <span style={{ display: "flex", gap: 6 }}>
            <input type="number" name="avgYear1" id="avg-year1" defaultValue={params.avgYear1 ?? ""} placeholder="год" style={{ width: 80 }} />
            <input type="number" name="avgYear2" id="avg-year2" defaultValue={params.avgYear2 ?? ""} placeholder="год" style={{ width: 80 }} />
          </span>
        </label>
        <label className="field">
          <span>Заработок у других работодателей за годы замены (по справкам)</span>
          <span style={{ display: "flex", gap: 6 }}>
            <input type="text" inputMode="decimal" name="avgOtherR1" id="avg-other-r1" defaultValue={params.avgOtherR1 ?? ""} placeholder="1-й год" style={{ width: 120 }} />
            <input type="text" inputMode="decimal" name="avgOtherR2" id="avg-other-r2" defaultValue={params.avgOtherR2 ?? ""} placeholder="2-й год" style={{ width: 120 }} />
          </span>
        </label>
        <SubmitButton className="btn btn-secondary">
          Рассчитать
        </SubmitButton>
      </form>

      {error ? (
        <p className="form-error" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}

      {preview ? (
        <div style={{ marginTop: 16 }}>
          {preview.kind === "vacation" ? <VacationBreakdown preview={preview} days={Number(params.avgDays)} /> : null}
          {preview.kind === "sick" ? <SickBreakdown preview={preview} days={Number(params.avgDays)} pct={preview.tenure.pct} /> : null}

          <form action={addAverageEarningsLineAction.bind(null, runId)} style={{ marginTop: 12 }}>
            {AVERAGE_FIELDS.map((f) => (
              <input key={f} type="hidden" name={f} value={params[f] ?? ""} />
            ))}
            <SubmitButton className="btn btn-primary">
              Добавить строку «{preview.kind === "vacation" ? "Отпускные" : "Больничные"}» на {formatMoney(preview.lineAmount)} —{" "}
              {preview.employee.fullName}
            </SubmitButton>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function VacationBreakdown({ preview, days }: { preview: Extract<AverageEarningsPreview, { kind: "vacation" }>; days: number }) {
  const v = preview.vacation;
  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Месяц</th>
              <th>Календарных дней</th>
              <th>В периоде работы</th>
              <th>Исключено (отпуск, болезнь, командировка)</th>
              <th>Дней в расчёт</th>
              <th>Заработок</th>
              {preview.indexation ? <th>Коэф. индексации</th> : null}
              {preview.indexation ? <th>После индексации</th> : null}
            </tr>
          </thead>
          <tbody>
            {v.months.map((m) => (
              <tr key={`${m.year}-${m.month}`}>
                <td>
                  {MONTH_NAMES_SHORT[m.month - 1]} {m.year}
                </td>
                <td>{m.calendarDays}</td>
                <td>{m.employedDays}</td>
                <td>{m.excludedDays || "—"}</td>
                <td className="mono">{formatNumber(m.countedDays)}</td>
                <td className="mono">{formatMoney(m.earnings)}</td>
                {preview.indexation ? <td className="mono">{m.indexCoef ? formatNumber(m.indexCoef.toDecimalPlaces(4)) : "—"}</td> : null}
                {preview.indexation ? <td className="mono">{formatMoney(m.indexedEarnings)}</td> : null}
              </tr>
            ))}
            <tr style={{ background: "var(--color-graphite-50)", fontWeight: 700 }}>
              <td>Итого</td>
              <td />
              <td />
              <td />
              <td className="mono">{formatNumber(v.totalDays)}</td>
              <td className="mono">{formatMoney(sumMoney(v.months.map((m) => m.earnings)))}</td>
              {preview.indexation ? <td /> : null}
              {preview.indexation ? <td className="mono">{formatMoney(v.totalEarnings)}</td> : null}
            </tr>
          </tbody>
        </table>
      </div>
      {v.method === "average" ? (
        <p>
          Средний дневной заработок: {formatMoney(v.totalEarnings)} / {formatNumber(v.totalDays)} дн. ={" "}
          <strong>{formatMoney(v.avgDaily)}</strong>. Полный месяц — {formatNumber(AVG_DAYS_PER_MONTH)} дн., неполный —
          пропорционально отработанным календарным дням.
        </p>
      ) : (
        <p>
          В расчётном периоде нет начислений или отработанных дней, поэтому средний заработок определён по окладу (п. 8
          Положения № 922): оклад / {formatNumber(AVG_DAYS_PER_MONTH)} = <strong>{formatMoney(v.avgDaily)}</strong>.
        </p>
      )}
      {v.afterPeriod ? (
        <p style={{ marginTop: 4 }}>
          Оклад повышен {v.afterPeriod.date.toLocaleDateString("ru-RU", { timeZone: "UTC" })} — после расчётного периода, до начала
          отпуска: средний {formatMoney(v.afterPeriod.avgDailyBefore)} × {formatNumber(v.afterPeriod.coef.toDecimalPlaces(4))} ={" "}
          {formatMoney(v.avgDaily)}.
        </p>
      ) : null}
      {v.duringVacation.map((d) => (
        <p key={d.date.toISOString()} style={{ marginTop: 4 }}>
          Оклад повышен во время отпуска, с {d.date.toLocaleDateString("ru-RU", { timeZone: "UTC" })}: {d.days} дн. оплачены по
          среднему × {formatNumber(d.coef.toDecimalPlaces(4))}.
        </p>
      ))}
      <p style={{ marginTop: 4 }}>
        Отпускные{v.duringVacation.length ? "" : `: ${formatMoney(v.avgDaily)} × ${days} дн.`} = <strong>{formatMoney(v.amount)}</strong>.
      </p>
      {preview.raises.length > 0 && !preview.indexation ? (
        <p className="text-muted" style={{ marginTop: 4 }}>
          В расчётном периоде или во время отпуска оклад повышался:{" "}
          {preview.raises
            .map((r) => `${r.date.toLocaleDateString("ru-RU", { timeZone: "UTC" })} ${r.from ? `с ${formatMoney(r.from)} ` : ""}до ${formatMoney(r.to)}`)
            .join("; ")}
          . Если оклады повышались во всей организации или подразделении, отметьте индексацию (п. 16 Положения № 922).
        </p>
      ) : null}
      {preview.indexation ? (
        <p className="text-muted" style={{ marginTop: 4 }}>
          Индексируются только выплаты видов с отметкой «индексируется при повышении оклада» (оклад, аванс); премии
          фиксированной суммой — нет. Месяц, в котором оклад повысили, не индексируется.
        </p>
      ) : null}
    </>
  );
}

function SickBreakdown({
  preview,
  days,
  pct,
}: {
  preview: Extract<AverageEarningsPreview, { kind: "sick" }>;
  days: number;
  pct: number;
}) {
  const s = preview.sick;
  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Год</th>
              <th>Заработок у нас</th>
              <th>У других работодателей</th>
              <th>Предельная база</th>
              <th>Учитывается</th>
            </tr>
          </thead>
          <tbody>
            {s.years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td className="mono">{formatMoney(y.earnings)}</td>
                <td className="mono">{formatMoney(y.otherEmployers)}</td>
                <td className="mono">{formatMoney(y.limit)}</td>
                <td className="mono">{formatMoney(y.counted)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Средний дневной заработок по факту: сумма за 2 года / {SICK_LEAVE_DIVISOR} = {formatMoney(s.avgDailyActual)}; минимум
        из МРОТ (МРОТ{s.districtCoef.equals(1) ? "" : " × районный коэффициент"} × 24 / {SICK_LEAVE_DIVISOR}) = {formatMoney(s.minDaily)}. В расчёт:{" "}
        <strong>{formatMoney(s.avgDaily)}</strong> {s.basis === "mrot" ? "(по МРОТ — фактический заработок ниже минимума)" : "(по факту)"}.
      </p>
      <p style={{ marginTop: 4 }}>
        Пособие в день: {formatMoney(s.avgDaily)} × {pct}% = {formatMoney(s.dailyBenefit)}; за {days} дн. —{" "}
        <strong>{formatMoney(s.total)}</strong>. За счёт работодателя — первые {s.employerDays} дн.:{" "}
        <strong>{formatMoney(s.employerAmount)}</strong> (эта сумма попадёт в расчёт); остальное —{" "}
        {formatMoney(s.fundAmount)} — выплачивает Социальный фонд напрямую.
      </p>
      <p style={{ marginTop: 4 }}>
        Страховой стаж:{" "}
        {preview.tenure.mode === "auto"
          ? `${Math.floor(preview.tenure.months! / 12)} лет ${preview.tenure.months! % 12} мес. по данным системы${preview.tenure.priorKnown ? "" : " (стаж до приёма в карточке сотрудника не указан — считается только работа у нас)"}`
          : "выбран вручную"}{" "}
        — {preview.tenure.pct}%{preview.tenure.short ? ", меньше 6 месяцев" : ""}.
        {s.districtCoef.equals(1) ? "" : ` Районный коэффициент организации — ${formatNumber(s.districtCoef)}.`}
      </p>
      {s.monthlyCaps.length > 0 ? (
        <p style={{ marginTop: 4 }}>
          Стаж меньше 6 месяцев — пособие не больше МРОТ{s.districtCoef.equals(1) ? "" : " × районный коэффициент"} за полный месяц:{" "}
          {s.monthlyCaps
            .map((c) => `${MONTH_NAMES_SHORT[c.month - 1]} ${c.year} — не больше ${formatMoney(c.capDaily)} в день${c.applied ? " (ограничение применено)" : ""}`)
            .join("; ")}
          .
        </p>
      ) : null}
      {preview.replacement ? (
        <p style={{ marginTop: 4 }}>
          Замена лет по заявлению на {preview.replacement.years.join(" и ")}: пособие {formatMoney(preview.replacement.replacedTotal)} против{" "}
          {formatMoney(preview.replacement.standardTotal)} без замены —{" "}
          {preview.replacement.used ? <strong>замена применена</strong> : "замена не увеличивает пособие, поэтому не применяется (ч. 1 ст. 14 Закона № 255-ФЗ)"}.
        </p>
      ) : null}
      <p className="text-muted" style={{ marginTop: 4 }}>
        Первые {EMPLOYER_PAID_SICK_DAYS} дня за счёт работодателя — общее правило для болезни самого сотрудника.
      </p>
    </>
  );
}
