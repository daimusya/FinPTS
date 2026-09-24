import { formatMoney, formatNumber } from "@/lib/money";
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
        исключаются. Больничные — за 2 года до года болезни (ст. 14 Закона № 255-ФЗ) с учётом предельной базы и МРОТ из
        справочника «Параметры расчёта зарплаты».
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
          <select name="avgPct" defaultValue={params.avgPct ?? "100"}>
            <option value="100">8 лет и больше — 100%</option>
            <option value="80">от 5 до 8 лет — 80%</option>
            <option value="60">до 5 лет — 60%</option>
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
        <button type="submit" className="btn btn-secondary">
          Рассчитать
        </button>
      </form>

      {error ? (
        <p className="form-error" style={{ marginTop: 12 }}>
          {error}
        </p>
      ) : null}

      {preview ? (
        <div style={{ marginTop: 16 }}>
          {preview.kind === "vacation" ? <VacationBreakdown preview={preview} days={Number(params.avgDays)} /> : null}
          {preview.kind === "sick" ? <SickBreakdown preview={preview} days={Number(params.avgDays)} pct={Number(params.avgPct ?? 100)} /> : null}

          <form action={addAverageEarningsLineAction.bind(null, runId)} style={{ marginTop: 12 }}>
            {AVERAGE_FIELDS.map((f) => (
              <input key={f} type="hidden" name={f} value={params[f] ?? ""} />
            ))}
            <button type="submit" className="btn btn-primary">
              Добавить строку «{preview.kind === "vacation" ? "Отпускные" : "Больничные"}» на {formatMoney(preview.lineAmount)} —{" "}
              {preview.employee.fullName}
            </button>
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
              </tr>
            ))}
            <tr style={{ background: "var(--color-graphite-50)", fontWeight: 700 }}>
              <td>Итого</td>
              <td />
              <td />
              <td />
              <td className="mono">{formatNumber(v.totalDays)}</td>
              <td className="mono">{formatMoney(v.totalEarnings)}</td>
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
      <p style={{ marginTop: 4 }}>
        Отпускные: {formatMoney(v.avgDaily)} × {days} дн. = <strong>{formatMoney(v.amount)}</strong>.
      </p>
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
        из МРОТ (МРОТ × 24 / {SICK_LEAVE_DIVISOR}) = {formatMoney(s.minDaily)}. В расчёт:{" "}
        <strong>{formatMoney(s.avgDaily)}</strong> {s.basis === "mrot" ? "(по МРОТ — фактический заработок ниже минимума)" : "(по факту)"}.
      </p>
      <p style={{ marginTop: 4 }}>
        Пособие в день: {formatMoney(s.avgDaily)} × {pct}% = {formatMoney(s.dailyBenefit)}; за {days} дн. —{" "}
        <strong>{formatMoney(s.total)}</strong>. За счёт работодателя — первые {s.employerDays} дн.:{" "}
        <strong>{formatMoney(s.employerAmount)}</strong> (эта сумма попадёт в расчёт); остальное —{" "}
        {formatMoney(s.fundAmount)} — выплачивает Социальный фонд напрямую.
      </p>
      <p className="text-muted" style={{ marginTop: 4 }}>
        Не учитываются: ограничение пособия одним МРОТ в месяц при стаже меньше 6 месяцев, районные коэффициенты, замена
        лет расчётного периода по заявлению сотрудника. Первые {EMPLOYER_PAID_SICK_DAYS} дня за счёт работодателя — общее
        правило для болезни самого сотрудника.
      </p>
    </>
  );
}
