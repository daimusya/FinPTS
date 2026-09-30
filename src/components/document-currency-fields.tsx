import { CURRENCY_OPTIONS } from "@/lib/currency";

/**
 * Валюта и курс документа начисления. Суммы строк вводятся в валюте
 * документа; курс пустой — берётся курс ЦБ на дату документа.
 */
export function DocumentCurrencyFields({ currency = "RUB", rate = "" }: { currency?: string; rate?: string }) {
  return (
    <>
      <label className="field">
        <span>Валюта документа</span>
        <select name="currency" id="doc-currency" defaultValue={currency}>
          {CURRENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Курс, руб. за единицу</span>
        <input
          type="text"
          inputMode="decimal"
          name="exchangeRate"
          id="doc-rate"
          defaultValue={rate}
          placeholder="пусто — курс ЦБ на дату документа"
          title="Для документа в валюте: суммы строк — в валюте, в отчётах — рубли по этому курсу. Пусто — курс ЦБ на дату документа (справочник «Курсы валют»)"
        />
      </label>
    </>
  );
}
