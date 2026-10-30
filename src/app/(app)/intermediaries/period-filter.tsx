import Link from "next/link";
import { dateParam, periodPresets, periodQuery, samePeriod, type Period } from "@/lib/intermediaries/period";

const withQuery = (path: string, query: Record<string, string>, anchor?: string) =>
  `${path}?${new URLSearchParams(query).toString()}${anchor ? `#${anchor}` : ""}`;

/** Выбор периода «с/по» и быстрые варианты; ссылки сохраняют путь страницы. */
export function PeriodFilter({ path, period, anchor, extra = {} }: { path: string; period: Period; anchor?: string; extra?: Record<string, string> }) {
  return (
    <div className="period-filter">
      <form action={path} className="filter-bar" style={{ marginBottom: 8 }}>
        {Object.entries(extra).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="field">
          <span>С</span>
          <input type="date" name="from" id="period-from" defaultValue={period.from ? dateParam(period.from) : ""} />
        </label>
        <label className="field">
          <span>По</span>
          <input type="date" name="to" id="period-to" defaultValue={dateParam(period.to)} />
        </label>
        <button type="submit" className="btn btn-secondary">
          Показать
        </button>
      </form>
      <div className="period-filter__presets">
        {periodPresets().map((preset) => (
          <Link
            key={preset.label}
            href={withQuery(path, { ...extra, ...periodQuery(preset.period) }, anchor)}
            className={`btn btn-sm ${samePeriod(preset.period, period) ? "btn-primary" : "btn-ghost"}`}
            aria-current={samePeriod(preset.period, period) ? "true" : undefined}
          >
            {preset.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export const periodHref = (path: string, period: Period, anchor?: string) => withQuery(path, periodQuery(period), anchor);
