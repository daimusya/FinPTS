import { loadCbrRatesAction } from "@/app/(app)/master-data/currency-rate-actions";
import { accountCurrencies } from "@/lib/currency-rates";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { localDateKey } from "@/lib/payment-calendar";

/**
 * Загрузка официальных курсов ЦБ РФ за период. Валюты счетов и касс
 * загружаются всегда; другие можно отметить.
 */
export async function CurrencyRatesLoader({ error }: { error?: string }) {
  const used = await accountCurrencies();
  const today = localDateKey();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  return (
    <div className="card" id="cbr" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Загрузить курсы ЦБ РФ</h2>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 10 }}>
        Операции по валютным счетам пересчитываются в рубли по курсу на дату операции, остатки — по курсу на дату отчёта; разница
        показывается как курсовая. Курс на дату — последний установленный ЦБ не позже неё. Сегодняшний курс загружается и
        автоматически вместе с выписками по API банков. Курс, введённый вручную, загрузка не перезаписывает.
        {used.length > 0 ? ` Валюты счетов и касс: ${used.join(", ")}.` : " Все счета и кассы сейчас в рублях."}
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      <form action={loadCbrRatesAction} className="form-grid" style={{ alignItems: "flex-end" }}>
        <label className="field">
          <span>С даты</span>
          <input type="date" name="from" id="cbr-from" defaultValue={yearStart} required />
        </label>
        <label className="field">
          <span>По дату</span>
          <input type="date" name="to" id="cbr-to" defaultValue={today} required />
        </label>
        <fieldset className="field" style={{ gridColumn: "1 / -1", border: 0, padding: 0, margin: 0 }}>
          <span>Ещё валюты (кроме валют счетов)</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
            {CURRENCY_OPTIONS.filter((o) => o.value !== "RUB" && !used.includes(o.value)).map((o) => (
              <label key={o.value} style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 13 }}>
                <input type="checkbox" name="currency" value={o.value} id={`cbr-cur-${o.value}`} /> {o.value}
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" className="btn btn-primary">
          Загрузить с сайта ЦБ
        </button>
      </form>
    </div>
  );
}
